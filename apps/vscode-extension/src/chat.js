const vscode = require('vscode');
const { BackendUnreachableError } = require('./client');

/**
 * @promptguard chat participant: masks secrets and PII and checks for prompt
 * injection before the prompt reaches the language model.
 *
 * Fails closed: if the PromptGuard backend can't be reached, nothing is
 * forwarded — the point of asking @promptguard is that the prompt is checked.
 */

const HELP = [
  'Ask anything, prefixed with **@promptguard**. Before your prompt reaches the model, PromptGuard:',
  '',
  '1. checks it for prompt-injection attempts, and',
  '2. masks secrets and personal data (keys, cards, Aadhaar, names, …).',
  '',
  'You see what was masked; the model only ever sees the masked prompt.',
].join('\n');

/**
 * @param {import('./client').Client} client
 */
function createHandler(client) {
  return async (request, _chatContext, stream, token) => {
    const prompt = request.prompt.trim();
    if (!prompt) {
      stream.markdown(HELP);
      return {};
    }

    stream.progress('Checking your prompt with PromptGuard…');
    let masked;
    try {
      masked = await client.mask(prompt, 'REDACT');
    } catch (err) {
      const why = err instanceof BackendUnreachableError ? err.message : `PromptGuard error: ${err.message}`;
      stream.markdown(`⚠️ ${why}. Your prompt was **not** sent to the model.`);
      return { metadata: { blocked: 'backend' } };
    }

    const block = vscode.workspace.getConfiguration('promptguard').get('chat.blockInjection');
    if (masked.injection?.isInjection && block) {
      stream.markdown(
        `🛑 This looks like a prompt-injection attempt (${Math.round(masked.injection.score * 100)}% likely), ` +
        'so it was **not** sent to the model. Turn off `promptguard.chat.blockInjection` to allow it.');
      return { metadata: { blocked: 'injection' } };
    }

    if (masked.maskedCount > 0) {
      const categories = [...new Set(masked.replacements.map((r) => r.category))].join(', ');
      stream.markdown(`> 🔒 Masked ${masked.maskedCount} value${masked.maskedCount === 1 ? '' : 's'} (${categories}) before sending.\n\n`);
    }

    const model = request.model ?? (await vscode.lm.selectChatModels())[0];
    if (!model) {
      stream.markdown('No language model is available. The masked prompt is:\n\n```\n' + masked.maskedText + '\n```');
      return {};
    }

    const response = await model.sendRequest([vscode.LanguageModelChatMessage.User(masked.maskedText)], {}, token);
    for await (const fragment of response.text) {
      stream.markdown(fragment);
    }
    return { metadata: { masked: masked.maskedCount } };
  };
}

/** Registers @promptguard when the Chat API is available (it isn't in every VS Code build). */
function registerChat(context, client) {
  if (!vscode.chat?.createChatParticipant) return null;
  const participant = vscode.chat.createChatParticipant('promptguard.chat', createHandler(client));
  participant.iconPath = new vscode.ThemeIcon('shield');
  context.subscriptions.push(participant);
  return participant;
}

module.exports = { registerChat, createHandler, HELP };
