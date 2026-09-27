import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'data', 'todos.json');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Ensure data folder and file exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

function loadTodos() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading todos file:', err.message);
  }
  // Default sample todos
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
  saveTodos(initialTodos);
  return initialTodos;
}

function saveTodos(todos) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving todos file:', err.message);
  }
}

// Helper to get Gemini client if API key is configured
function getGeminiClient(customApiKey) {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// --- CRUD Routes ---

// Get all todos
app.get('/api/todos', (req, res) => {
  const todos = loadTodos();
  res.json({ success: true, count: todos.length, data: todos });
});

// Create new todo
app.post('/api/todos', (req, res) => {
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
app.put('/api/todos/:id', (req, res) => {
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
    id: todos[index].id, // Prevent ID change
    updatedAt: new Date().toISOString()
  };

  saveTodos(todos);
  res.json({ success: true, data: todos[index] });
});

// Delete todo
app.delete('/api/todos/:id', (req, res) => {
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

// 1. AI Task Breakdown: Takes a high-level goal and generates actionable subtasks
app.post('/api/ai/breakdown', async (req, res) => {
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
      // Clean possible markdown code fences
      const cleaned = responseText.replace(/```json\s*|```/g, '').trim();
      const tasks = JSON.parse(cleaned);
      return res.json({ success: true, source: 'gemini-3.8-flash', tasks });
    } catch (err) {
      console.warn('Gemini API call failed, falling back to smart heuristic:', err.message);
    }
  }

  // Fallback intelligent breakdown if no Gemini key or rate limited
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
    message: gemini ? 'Gemini response parsed with fallback' : 'Note: Configure GEMINI_API_KEY in .env for live Gemini 3.8 Flash model generation',
    tasks: fallbackTasks
  });
});

// 2. AI Prioritize & Recommendations: Analyzes existing todos and gives priority advice
app.post('/api/ai/prioritize', async (req, res) => {
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
      const prompt = `Analyze these pending tasks and provide a concise, high-value summary of what the user should focus on first, which task is the quickest win, and actionable advice:
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

  // Fallback heuristic
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

// 3. AI Daily Briefing: Quick motivating status summary
app.post('/api/ai/briefing', async (req, res) => {
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ai-todo-be', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
