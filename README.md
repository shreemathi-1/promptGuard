# Data Leakage Prevention and Detection System

## Overview

The Data Leakage Prevention and Detection (DLP) System is a cybersecurity solution designed to identify, prevent, and monitor the unauthorized exposure of sensitive information. The system consists of two major components:

Web Application – Provides centralized monitoring, policy management, incident tracking, and reporting.
VS Code Extension – Detects sensitive information during software development and alerts developers before code containing confidential data is committed or shared.

The project helps organizations reduce the risk of accidental or intentional data leaks by implementing real-time detection mechanisms and proactive security controls.

## Problem Statement

Developers and employees often unintentionally expose sensitive information such as:

API Keys
Access Tokens
Database Credentials
Passwords
Personally Identifiable Information (PII)
Confidential Business Data

Traditional security measures typically detect leaks after the data has already been exposed. Organizations require a proactive system capable of identifying risks before data leaves the development environment.

## Proposed Solution

The Data Leakage Prevention and Detection System continuously scans files and user activities to detect sensitive information using predefined security rules and pattern-matching techniques.

The VS Code extension performs real-time detection during development, while the web application provides centralized management, monitoring, analytics, and incident reporting.

## Key Features

VS Code Extension
Real-time code scanning
API key detection
Password detection
Secret token detection
Credential exposure alerts
Warning notifications
Security recommendations
Lightweight integration
Web Application
Centralized dashboard
Incident management
Alert monitoring
Leak statistics visualization
User management
Security policy management
Audit logging
Reporting system
Security Monitoring
Pattern-based detection
Risk classification
Incident tracking
Threat analytics
Security reporting

## Technology Stack

### Frontend
React.js
HTML5
CSS3
JavaScript

### Backend
Node.js
Express.js
Database
MongoDB

### Extension Development
VS Code Extension API
TypeScript / JavaScript
Additional Tools
Git
GitHub
REST APIs

## System Architecture
Developer Code
       │
       ▼
VS Code Extension
       │
Sensitive Data Detection
       │
       ▼
Alert Generation
       │
       ▼
Backend API
       │
       ▼
MongoDB Database
       │
       ▼
Web Dashboard
       │
       ▼
Security Administrator

## Installation
Clone Repository
git clone <repository-url>
cd dlp-system
Install Backend
npm install
Install Frontend
cd frontend
npm install


## Configure Environment Variables
PORT=5000
MONGO_URI=your_database_url
JWT_SECRET=your_secret_key
Start Backend
npm start
Start Frontend
npm run dev
Run VS Code Extension
npm install
npm run compile
F5

## Working
Developer writes code in VS Code.
Extension scans source files.
Sensitive information patterns are detected.
Warning notification is generated.
Incident is logged in the backend.
Dashboard displays detected incidents.
Administrator reviews and manages alerts.
Security Features
Real-time monitoring
Secret detection
Risk categorization
Incident logging
Audit trail generation
Centralized management
Future Enhancements
AI-powered leak detection
Machine learning classification
GitHub integration
Email alerts
Slack integration
OCR-based document scanning
Source code repository scanning
Compliance reporting (GDPR, HIPAA)

## Applications
Software Development Teams
Enterprises
Educational Institutions
Government Organizations
Financial Institutions
Healthcare Organizations

## Contributors
Shreemathi

## License

This project is developed for educational, research, and cybersecurity awareness purposes.