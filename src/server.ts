// File: src/server.ts

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-do-not-use-in-prod';
const prisma = new PrismaClient();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// --- Auth Middleware ---
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// --- Lesson Plans Routes ---
app.get('/api/plans', authenticate, async (req: any, res) => {
  const { role, id } = req.user;
  const where: any = {};
  if (role === 'TEACHER') where.teacherId = id; // Teachers only see their own
  
  const plans = await prisma.lessonPlan.findMany({
    where,
    include: { teacher: { select: { name: true } } },
    orderBy: { weekOf: 'desc' }
  });
  res.json(plans);
});

app.post('/api/plans', authenticate, requireRole(['TEACHER']), async (req: any, res) => {
  const { title, weekOf, objective, standards, activities, assessment, status } = req.body;
  const plan = await prisma.lessonPlan.create({
    data: {
      teacherId: req.user.id,
      title, weekOf, objective, standards, activities, assessment, status: status || 'DRAFT'
    }
  });
  res.json(plan);
});

app.put('/api/plans/:id', authenticate, async (req: any, res) => {
  const { title, weekOf, objective, standards, activities, assessment, status } = req.body;
  const plan = await prisma.lessonPlan.update({
    where: { id: req.params.id },
    data: { title, weekOf, objective, standards, activities, assessment, status }
  });
  res.json(plan);
});

// --- Analytics (Principals Only) ---
app.get('/api/analytics', authenticate, requireRole(['PRINCIPAL', 'ADMIN']), async (req, res) => {
  const totalPlans = await prisma.lessonPlan.count();
  const submittedCount = await prisma.lessonPlan.count({ where: { status: 'SUBMITTED' } });
  
  // Aggregate standards manually (simple frequency map)
  const allPlans = await prisma.lessonPlan.findMany({ select: { standards: true } });
  const standardFreq: Record<string, number> = {};
  allPlans.forEach(p => {
    const stds = p.standards.split(',').map(s => s.trim()).filter(Boolean);
    stds.forEach(s => { standardFreq[s] = (standardFreq[s] || 0) + 1; });
  });
  
  const topStandards = Object.entries(standardFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  res.json({ totalPlans, submittedCount, topStandards });
});

// --- Settings/Branding Routes ---
app.get('/api/settings', async (req, res) => {
  const settings = await prisma.setting.findMany();
  const map = settings.reduce((acc: any, curr) => ({ ...acc, [curr.key]: curr.value }), {});
  res.json(map);
});

app.put('/api/settings', authenticate, requireRole(['ADMIN']), async (req, res) => {
  const { key, value } = req.body;
  const setting = await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value }
  });
  res.json(setting);
});

// --- Users (Admin Only) ---
app.get('/api/users', authenticate, requireRole(['ADMIN']), async (req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } });
  res.json(users);
});

app.post('/api/users', authenticate, requireRole(['ADMIN']), async (req, res) => {
  const { name, email, password, role } = req.body;
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role }
  });
  res.json(user);
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
