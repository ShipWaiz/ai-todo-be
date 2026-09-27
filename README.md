# 🚀 AI-Powered To-Do Backend (`ai-todo-be`)

A lightweight, robust Node.js + Express backend service providing standard To-Do CRUD APIs along with Google Gemini AI capabilities.

## ✨ Features

- **To-Do CRUD**: Create, read, update status/details, and delete todos.
- **Persistent Storage**: Lightweight JSON file storage (`data/todos.json`) requiring zero database setup.
- **AI Task Breakdown (`POST /api/ai/breakdown`)**: Takes any high-level objective (e.g., "Prepare for hackathon", "Launch product landing page") and breaks it into actionable subtasks with recommended priorities and categories using **Gemini 3.8 Flash**.
- **AI Prioritization & Analysis (`POST /api/ai/prioritize`)**: Evaluates active tasks, identifies quick wins, and provides productivity guidance.
- **AI Daily Briefing (`POST /api/ai/briefing`)**: Generates an inspiring daily summary based on completed vs. pending tasks.
- **Zero-Config Fallback**: If `GEMINI_API_KEY` is not provided, the API automatically uses built-in smart heuristics, ensuring the PoC works immediately.

## 🛠️ API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server health check |
| `GET` | `/api/todos` | Fetch all todos |
| `POST` | `/api/todos` | Create a new todo (`{ text, priority, category, dueDate }`) |
| `PUT` | `/api/todos/:id` | Update a todo (`{ completed, text, priority, ... }`) |
| `DELETE` | `/api/todos/:id` | Delete a todo |
| `POST` | `/api/ai/breakdown` | AI subtask breakdown (`{ goal, apiKey? }`) |
| `POST` | `/api/ai/prioritize` | AI smart prioritization and quick-win analysis |
| `POST` | `/api/ai/briefing` | AI daily productivity briefing |

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env` and configure:
```env
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Run the Server
```bash
# Production mode
npm start

# Development watch mode
npm run dev
```

Server runs on `http://localhost:5000`.
