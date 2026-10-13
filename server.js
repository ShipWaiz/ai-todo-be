import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

// Safe directory resolution across ESM and Netlify CJS bundles
let currentDir = process.cwd();
try {
  if (typeof __dirname !== 'undefined') {
    currentDir = __dirname;
  } else if (typeof import.meta !== 'undefined' && import.meta && typeof import.meta.url === 'string') {
    currentDir = path.dirname(fileURLToPath(import.meta.url));
  }
} catch (e) {
  currentDir = process.cwd();
}

const IS_SERVERLESS = Boolean(
  process.env.NETLIFY || 
  process.env.AWS_LAMBDA_FUNCTION_NAME || 
  process.env.LAMBDA_TASK_ROOT ||
  process.env.LAMBDA_RUNTIME_DIR
);

const DATA_FILE = IS_SERVERLESS
  ? path.join('/tmp', 'todos.json')
  : path.join(currentDir, 'data', 'todos.json');

// Ensure directory exists if possible
try {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (e) {
  // Silent fallback for restricted environments
}

// In-memory fallback
let memoryTodos = null;

const initialTodos = [
  {
    id: '1',
    text: 'Explore AI-powered To-Do app features',
    completed: true,
    priority: 'high',
    category: 'Work',
    createdAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: '2',
    text: 'Try "Smart Breakdown" to split a big project into actionable steps',
    completed: false,
    priority: 'high',
    category: 'Learning',
    createdAt: new Date().toISOString()
  },
  {
    id: '3',
    text: 'Review GitHub repositories and invite team members',
    completed: false,
    priority: 'medium',
    category: 'Work',
    createdAt: new Date().toISOString()
  }
];

function loadTodos() {
  if (memoryTodos) return memoryTodos;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      memoryTodos = JSON.parse(data);
      return memoryTodos;
    }
  } catch (err) {
    console.warn('Filesystem read note:', err.message);
  }
  memoryTodos = [...initialTodos];
  saveTodos(memoryTodos);
  return memoryTodos;
}

function saveTodos(todos) {
  memoryTodos = todos;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Filesystem write note:', err.message);
  }
}

// Helper to get Gemini client
function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Main router
const router = express.Router();

// Root API overview
router.get('/', (req, res) => {
  res.json({
    service: 'AI Smart To-Do Backend API',
    status: 'online',
    serverless: IS_SERVERLESS,
    environment: process.env.BRANCH ? `Netlify [${process.env.BRANCH.toUpperCase()}]` : (IS_SERVERLESS ? 'Netlify Serverless' : 'Local Node.js'),
    branch: process.env.BRANCH || (process.env.NODE_ENV === 'production' ? 'production' : 'local'),
    message: 'Backend is active and responding on Netlify!',
    endpoints: {
      todos: '/api/todos',
      health: '/api/health',
      aiBreakdown: 'POST /api/ai/breakdown',
      aiPrioritize: 'POST /api/ai/prioritize',
      aiBriefing: 'POST /api/ai/briefing'
    },
    hint: 'Open your ai-todo-fe Netlify site to view and interact with the full web UI!'
  });
});

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-todo-be',
    serverless: IS_SERVERLESS,
    timestamp: new Date().toISOString()
  });
});

// --- CRUD Routes ---

// Get all todos
router.get('/todos', (req, res) => {
  const todos = loadTodos();
  res.json({ success: true, count: todos.length, data: todos });
});

// Create new todo
router.post('/todos', (req, res) => {
  const { text, priority = 'medium', category = 'General', dueDate = null } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ success: false, error: 'Task text is required' });
  }

  const todos = loadTodos();
  const newTodo = {
    id: Date.now().toString(),
    text: text.trim(),
    completed: false,
    priority: ['low', 'medium', 'high'].includes(priority.toLowerCase()) ? priority.toLowerCase() : 'medium',
    category: category.trim() || 'General',
    dueDate,
    createdAt: new Date().toISOString()
  };

  todos.unshift(newTodo);
  saveTodos(todos);
  res.status(201).json({ success: true, data: newTodo });
});

// Update todo
router.put('/todos/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const todos = loadTodos();
  const index = todos.findIndex(t => t.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Todo not found' });
  }

  todos[index] = {
    ...todos[index],
    ...updates,
    id: todos[index].id,
    updatedAt: new Date().toISOString()
  };

  saveTodos(todos);
  res.json({ success: true, data: todos[index] });
});

// Delete todo
router.delete('/todos/:id', (req, res) => {
  const { id } = req.params;
  const todos = loadTodos();
  const filtered = todos.filter(t => t.id !== id);

  if (filtered.length === todos.length) {
    return res.status(404).json({ success: false, error: 'Todo not found' });
  }

  saveTodos(filtered);
  res.json({ success: true, message: 'Todo deleted successfully' });
});

// --- AI Endpoints ---

// 1. AI Task Breakdown
router.post('/ai/breakdown', async (req, res) => {
  const { goal, apiKey: clientApiKey } = req.body;
  if (!goal || goal.trim() === '') {
    return res.status(400).json({ success: false, error: 'Goal description is required' });
  }

  const gemini = getGeminiClient(clientApiKey);

  if (gemini) {
    try {
      const prompt = `Break down this high-level goal into 3 to 5 clear, realistic, and actionable subtasks.
Goal: "${goal}"

Return ONLY a valid JSON array of objects with no markdown wrapping or code fences.
Format:
[
  {
    "text": "Subtask title here",
    "priority": "high" | "medium" | "low",
    "category": "Work" | "Personal" | "Learning" | "Health" | "General"
  }
]`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt
      });

      const responseText = response.text || '';
      const cleaned = responseText.replace(/```json\s*|```/g, '').trim();
      const tasks = JSON.parse(cleaned);
      return res.json({ success: true, source: 'gemini-3.8-flash', tasks });
    } catch (err) {
      console.warn('Gemini API call failed, falling back to smart heuristic:', err.message);
    }
  }

  const fallbackTasks = [
    { text: `Research best practices and define requirements for "${goal}"`, priority: 'high', category: 'Planning' },
    { text: `Draft initial plan and gather necessary resources`, priority: 'medium', category: 'Work' },
    { text: `Execute the first core milestone of "${goal}"`, priority: 'high', category: 'Execution' },
    { text: `Review progress, test, and iterate`, priority: 'medium', category: 'Review' },
    { text: `Finalize and document completion`, priority: 'low', category: 'General' }
  ];

  res.json({
    success: true,
    source: 'smart-fallback',
    message: gemini ? 'Gemini response parsed with fallback' : 'Note: Configure GEMINI_API_KEY for live Gemini 3.8 Flash generation',
    tasks: fallbackTasks
  });
});

// 2. AI Prioritize & Recommendations
router.post('/ai/prioritize', async (req, res) => {
  const todos = loadTodos();
  const uncompleted = todos.filter(t => !t.completed);

  if (uncompleted.length === 0) {
    return res.json({
      success: true,
      analysis: 'All caught up! You have no pending tasks. Great time to plan your next goal with AI Smart Breakdown.',
      quickWin: null
    });
  }

  const { apiKey: clientApiKey } = req.body;
  const gemini = getGeminiClient(clientApiKey);

  if (gemini) {
    try {
      const prompt = `Analyze these pending tasks and provide a concise summary of what the user should focus on first, which task is the quickest win, and actionable advice:
${JSON.stringify(uncompleted.map(t => ({ id: t.id, text: t.text, priority: t.priority, category: t.category })))}

Return ONLY valid JSON:
{
  "focusTask": "Text of the most important task to do first",
  "quickWin": "Text of the fastest task to complete",
  "advice": "1-2 sentences of strategic productivity coaching"
}`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt
      });

      const cleaned = (response.text || '').replace(/```json\s*|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return res.json({ success: true, source: 'gemini-3.8-flash', ...parsed });
    } catch (err) {
      console.warn('Gemini prioritize failed, falling back:', err.message);
    }
  }

  const highPriority = uncompleted.find(t => t.priority === 'high') || uncompleted[0];
  const quickWin = uncompleted.find(t => t.priority === 'low') || uncompleted[uncompleted.length - 1];

  res.json({
    success: true,
    source: 'smart-fallback',
    focusTask: highPriority.text,
    quickWin: quickWin.text,
    advice: `Focus first on "${highPriority.text}" to make substantial progress today, then knock out "${quickWin.text}" for momentum!`
  });
});

// 3. AI Daily Briefing
router.post('/ai/briefing', async (req, res) => {
  const todos = loadTodos();
  const pending = todos.filter(t => !t.completed);
  const done = todos.filter(t => t.completed);

  const { apiKey: clientApiKey } = req.body;
  const gemini = getGeminiClient(clientApiKey);

  if (gemini && pending.length > 0) {
    try {
      const prompt = `You are an energetic, sharp productivity coach. Write a 2-sentence morning briefing for a user who has ${pending.length} pending tasks (${pending.slice(0, 3).map(t => t.text).join(', ')}) and completed ${done.length} tasks. Keep it punchy and inspiring.`;
      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt
      });
      return res.json({
        success: true,
        source: 'gemini-3.8-flash',
        briefing: response.text?.trim()
      });
    } catch (err) {
      console.warn('Gemini briefing failed:', err.message);
    }
  }

  res.json({
    success: true,
    source: 'smart-fallback',
    briefing: `You've conquered ${done.length} task${done.length === 1 ? '' : 's'} and have ${pending.length} in your queue. Tackle your highest-priority items with steady focus today!`
  });
});

// Health check aliases for all container platforms
const healthHandler = (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-todo-be',
    serverless: IS_SERVERLESS,
    timestamp: new Date().toISOString()
  });
};

router.get('/health', healthHandler);
router.get('/healthz', healthHandler);
router.get('/api/health', healthHandler);
router.get('/ping', healthHandler);

// Mount routes flexibly for /api, /.netlify/functions/api, and root
app.use('/api', router);
app.use('/.netlify/functions/api', router);
app.use('/', router);

if (!IS_SERVERLESS) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
