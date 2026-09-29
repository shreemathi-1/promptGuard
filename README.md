# PromptGuard — Pre-Prompt Sensitive Data Protection System

A security-focused **pre-prompt checker** that helps users identify and protect sensitive information before using their prompts with AI chatbots.

## Overview

Users often include sensitive information in prompts without realizing it. **SecurePrompt** scans prompts before they are submitted to an AI chatbot and identifies potentially sensitive data such as email addresses, phone numbers, API keys, and IP addresses.

The system allows users to **review detected information, optionally mask it, and use the sanitized prompt** with their preferred AI chatbot. A centralized dashboard provides visibility into detected security incidents.

## Key Features

* **Pre-Prompt Scanning** — Scans user-entered prompts before they are used with AI chatbots.
* **Sensitive Data Detection** — Detects email addresses, phone numbers, API keys, IP addresses, and other predefined sensitive patterns.
* **Rule-Based Detection** — Uses pattern matching and predefined security rules to identify sensitive information.
* **Optional Data Masking** — Allows users to mask detected sensitive information before using the prompt.
* **Sanitized Prompt** — Generates a cleaned version of the prompt that can be copied and used with an AI chatbot.
* **Security Dashboard** — Provides centralized monitoring of detected sensitive-data incidents.
* **VS Code Extension** — Enables prompt scanning directly within the developer workflow.
* **REST API** — Connects the web application, VS Code extension, and detection engine.

## How It Works

```text
User enters AI prompt
        ↓
SecurePrompt scans the input
        ↓
Pattern Matching + Security Rules
        ↓
Sensitive information detected?
        ↓
   ┌────┴────┐
   No        Yes
   ↓          ↓
Prompt     Display detected
ready      sensitive data
              ↓
        User chooses to mask
              ↓
       Sanitized prompt
              ↓
       Use with AI chatbot
```

## Example

### Original Prompt

```text
Analyze this API configuration. My API key is sk-123456789
and contact me at user@example.com.
```

### Detected Information

```text
API Key: sk-123456789
Email: user@example.com
```

### Masked Prompt

```text
Analyze this API configuration. My API key is [MASKED]
and contact me at [MASKED].
```

The user can then copy the sanitized prompt and use it with an AI chatbot.

## Architecture

```text
                    ┌─────────────────────┐
                    │      User Prompt    │
                    └──────────┬──────────┘
                               ↓
              ┌────────────────────────────┐
              │     React Web Application  │
              └─────────────┬──────────────┘
                            ↓
                 ┌────────────────────┐
                 │   Express REST API │
                 └─────────┬──────────┘
                           ↓
                ┌─────────────────────┐
                │   Detection Engine  │
                │                     │
                │  Pattern Matching   │
                │  Security Rules     │
                └─────────┬───────────┘
                          ↓
                ┌─────────────────────┐
                │  Detection Result   │
                └───────┬─────────────┘
                        ↓
              ┌──────────────────────┐
              │   Optional Masking   │
              └──────────┬───────────┘
                         ↓
              ┌──────────────────────┐
              │   Sanitized Prompt   │
              └──────────────────────┘

        PostgreSQL ← Security Events / Incidents
```

## Technology Stack

| Layer                 | Technology                        |
| --------------------- | --------------------------------- |
| Frontend              | React                             |
| Backend               | Node.js, Express.js               |
| Database              | PostgreSQL                        |
| Detection             | Pattern Matching & Security Rules |
| Developer Integration | VS Code Extension                 |

## Project Components

### 1. Web Application

The web application allows users to:

* Enter prompts.
* Scan prompts for sensitive information.
* View detected sensitive data.
* Mask detected information.
* Generate a sanitized prompt.
* Monitor security incidents through the dashboard.

### 2. VS Code Extension

The VS Code extension provides prompt-scanning capabilities directly within the VS Code environment, allowing developers to check for sensitive information before using prompts in AI-assisted development workflows.

### 3. Detection Engine

The detection engine analyzes prompt content using predefined patterns and security rules.

Examples:

```text
Email Pattern     → user@example.com
Phone Pattern     → +91 9876543210
IP Pattern        → 192.168.1.10
API Key Pattern   → sk-xxxxxxxxxxxx
```

### 4. Security Dashboard

The dashboard provides centralized visibility into:

* Detected sensitive-data types
* Number of security incidents
* Masking activity
* Prompt scanning events

## API Flow

```text
React / VS Code Extension
          ↓
       REST API
          ↓
    Express.js Server
          ↓
    Detection Engine
          ↓
Detection + Masking Result
          ↓
React / VS Code Extension
```

## Database

**PostgreSQL** is used to store relevant security-event information, enabling centralized monitoring and analysis through the dashboard.

## Security Approach

SecurePrompt follows a **rule-based security approach** rather than an AI-based detection approach. It uses predefined patterns and security rules to identify known sensitive-data formats.

This approach provides:

* Predictable detection
* Explainable results
* Fast processing
* Customizable security rules

## Future Enhancements

* Add more sensitive-data detection rules.
* Support additional AI coding and chat platforms.
* Add configurable organization-specific security policies.
* Add severity-based risk scoring.
* Provide configurable blocking policies for high-risk data.
* Add additional IDE integrations.

## Project Structure

```text
promptGuard/
├── apps/
│   ├── backend/      # Express REST API, detection engine, PostgreSQL access
│   └── frontend/     # React (Vite) web application
├── docs/             # Documentation PDF and screenshots
├── docker-compose.yml
└── .env.example
```

## Getting Started

### Option 1: Docker (recommended)

```bash
cp .env.example .env          # optional: change the database password
docker compose up --build
```

| Service    | URL                              |
| ---------- | -------------------------------- |
| Web app    | http://localhost:5173            |
| API health | http://localhost:4000/api/health |
| PostgreSQL | localhost:5432                   |

The database schema is created on first start and the built-in rules are seeded automatically.
To reset the database, run `docker compose down -v`.

### Option 2: Run locally

Requires Node.js 20.19+ and PostgreSQL 14+.

```bash
# 1. Database
createdb dlp_db
psql -d dlp_db -f apps/backend/src/db/schema.sql

# 2. Backend
cd apps/backend
cp .env.example .env          # fill in your DB credentials
npm install
node src/patterns/seedPatterns.js
npm run dev

# 3. Frontend (new terminal)
cd apps/frontend
cp .env.example .env
npm install
npm run dev
```

## Tech Stack

**React · Node.js · Express.js · PostgreSQL**
