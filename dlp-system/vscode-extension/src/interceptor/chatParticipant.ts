import * as vscode from 'vscode';
import { Scanner }       from '../scanner';
import { PolicyEngine }  from '../policies/policyEngine';
import { Masker }        from '../masking/masker';
import { AuditLogger }   from '../audit/auditLogger';
import { WarningPanel }  from '../ui/warningPanel';

/**
 * DLP Chat Participant — registered as @dlp in VS Code Chat.
 *
 * Usage in Copilot Chat: @dlp <your prompt>
 *
 * This acts as a DLP-screened relay. The user's message is scanned
 * before being forwarded to the language model. If blocked, the message
 * is never forwarded.
 */
export function registerChatParticipant(
  context:      vscode.ExtensionContext,
  scanner:      Scanner,
  policyEngine: PolicyEngine,
  masker:       Masker,
  auditLogger:  AuditLogger,
  warningPanel: WarningPanel
): vscode.Disposable {

  const participant = vscode.chat.createChatParticipant(
    'dlp.guardian',
    async (
      request:  vscode.ChatRequest,
      chatCtx:  vscode.ChatContext,
      stream:   vscode.ChatResponseStream,
      token:    vscode.CancellationToken
    ) => {
      const userPrompt = request.prompt;

      // ── 1. Scan the prompt ──────────────────────────────────────────────
      const scanResult = await scanner.scan(userPrompt);
      const decision   = policyEngine.evaluate(scanResult);

      // ── 2. BLOCK ────────────────────────────────────────────────────────
      if (decision.action === 'BLOCK') {
        await auditLogger.log({
          action:        'BLOCK',
          detections:    scanResult.detections,
          promptPreview: userPrompt.slice(0, 100),
          source:        'chat-participant',
        });

        stream.markdown(
          `## 🚫 DLP Guardian — Prompt Blocked\n\n` +
          `${decision.message}\n\n` +
          `**Detected items:**\n` +
          scanResult.detections
            .map(d => `- \`${d.masked}\` — **${d.ruleName}** (${d.severity})`)
            .join('\n') +
          `\n\n*Remove the sensitive data and try again.*`
        );
        return;
      }

      // ── 3. MASK ─────────────────────────────────────────────────────────
      let promptToSend = userPrompt;
      if (decision.action === 'MASK') {
        const maskResult = masker.mask(userPrompt, scanResult.detections, 'REDACT');
        promptToSend     = maskResult.maskedText;

        await auditLogger.log({
          action:        'MASK',
          detections:    scanResult.detections,
          promptPreview: userPrompt.slice(0, 100),
          source:        'chat-participant',
        });

        stream.markdown(
          `*🔐 DLP Guardian auto-masked ${maskResult.maskedCount} item(s) before sending.*\n\n---\n\n`
        );
      }

      // ── 4. WARN ─────────────────────────────────────────────────────────
      if (decision.action === 'WARN') {
        const userChoice = await warningPanel.showInlineWarning(decision);

        if (userChoice === 'cancel') {
          await auditLogger.log({
            action:        'CANCEL',
            detections:    scanResult.detections,
            promptPreview: userPrompt.slice(0, 100),
            source:        'chat-participant',
          });
          stream.markdown(`*❌ Prompt cancelled by user after DLP warning.*`);
          return;
        }

        if (userChoice === 'mask') {
          const maskResult = masker.mask(userPrompt, scanResult.detections, 'REDACT');
          promptToSend     = maskResult.maskedText;
          await auditLogger.log({
            action:        'MASK_AND_SEND',
            detections:    scanResult.detections,
            promptPreview: userPrompt.slice(0, 100),
            source:        'chat-participant',
          });
        } else {
          // 'send-anyway'
          await auditLogger.log({
            action:        'WARN_OVERRIDE',
            detections:    scanResult.detections,
            promptPreview: userPrompt.slice(0, 100),
            source:        'chat-participant',
          });
        }
      }

      // ── 5. Forward to model ─────────────────────────────────────────────
      const messages = [
        vscode.LanguageModelChatMessage.User(promptToSend),
      ];

      try {
        const [model] = await vscode.lm.selectChatModels({
          vendor:  'copilot',
          family:  'gpt-4o',
        });

        if (!model) {
          stream.markdown('*No language model available. Ensure Copilot is enabled.*');
          return;
        }

        const response = await model.sendRequest(messages, {}, token);

        for await (const chunk of response.text) {
          stream.markdown(chunk);
        }
      } catch (err: any) {
        stream.markdown(`*Error forwarding to model: ${err.message}*`);
      }
    }
  );

  participant.iconPath = new vscode.ThemeIcon('shield');
  participant.followupProvider = {
    provideFollowups() {
      return [
        {
          prompt:  'Scan this file for sensitive data',
          label:   'Scan current file',
          command: 'dlp.scanCurrentFile',
        },
      ];
    },
  };

  return participant;
}