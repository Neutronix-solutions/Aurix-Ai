import { Router, Request } from "express";
import { db, gamificationStats, achievements } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 2000, 5000];
const LEVEL_NAMES = ["Rookie", "Saver", "Tracker", "Planner", "Investor", "Achiever", "Wealth Builder"];

const ACHIEVEMENTS_LIST = [
  { id: "first_expense", name: "First Entry", description: "Add your first expense" },
  { id: "week_streak", name: "7-Day Streak", description: "Log in 7 days in a row" },
  { id: "sms_master", name: "SMS Master", description: "Confirm 10 SMS transactions" },
  { id: "portfolio_start", name: "Investor", description: "Add your first portfolio holding" },
  { id: "goal_setter", name: "Goal Setter", description: "Create your first savings goal" },
  { id: "chat_ai", name: "Financial Student", description: "Chat with your AI coach" },
  { id: "score_60", name: "Planner", description: "Reach a financial score of 60" },
  { id: "score_80", name: "Wealth Builder", description: "Reach a financial score of 80" },
];

function getLevelInfo(points: number) {
  let level = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  const nextLevelPoints = level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  return { level, levelName: LEVEL_NAMES[level - 1] ?? "Master", nextLevelPoints };
}

router.get("/gamification", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    let [stats] = await db.select().from(gamificationStats).where(eq(gamificationStats.userId, userId)).limit(1);
    if (!stats) {
      [stats] = await db.insert(gamificationStats).values({ userId, points: 0, streak: 0, level: 1 }).returning();
    }
    const userAchievements = await db.select().from(achievements).where(eq(achievements.userId, userId));
    const earnedSet = new Set(userAchievements.map(a => a.achievementId));
    const { level, levelName, nextLevelPoints } = getLevelInfo(stats.points);
    const achievementsList = ACHIEVEMENTS_LIST.map(a => ({
      id: a.id, name: a.name, description: a.description,
      earned: earnedSet.has(a.id),
      earnedAt: userAchievements.find(ua => ua.achievementId === a.id)?.earnedAt,
    }));
    res.json({ points: stats.points, streak: stats.streak, level, levelName, nextLevelPoints, achievements: achievementsList });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

const ACTION_POINTS: Record<string, number> = {
  add_expense: 10, confirm_sms: 20, chat_ai: 5, update_portfolio: 15, complete_goal: 50, daily_login: 5,
};

router.post("/gamification/award", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { action } = req.body as { action: string };
    const points = ACTION_POINTS[action] ?? 5;
    let [stats] = await db.select().from(gamificationStats).where(eq(gamificationStats.userId, userId)).limit(1);
    if (!stats) {
      [stats] = await db.insert(gamificationStats).values({ userId, points: 0, streak: 0, level: 1 }).returning();
    }
    const now = new Date();
    const lastActive = stats.lastActive;
    let newStreak = stats.streak;
    if (lastActive) {
      const diff = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
      if (diff >= 1 && diff < 2) newStreak += 1;
      else if (diff >= 2) newStreak = 1;
    } else newStreak = 1;

    const newPoints = stats.points + points;
    const { level } = getLevelInfo(newPoints);
    const [updated] = await db.update(gamificationStats)
      .set({ points: newPoints, streak: newStreak, level, lastActive: now })
      .where(eq(gamificationStats.userId, userId)).returning();

    const userAchievements = await db.select().from(achievements).where(eq(achievements.userId, userId));
    const earnedSet = new Set(userAchievements.map(a => a.achievementId));

    if (action === "add_expense" && !earnedSet.has("first_expense")) {
      await db.insert(achievements).values({ userId, achievementId: "first_expense" });
      earnedSet.add("first_expense");
    }
    if (action === "chat_ai" && !earnedSet.has("chat_ai")) {
      await db.insert(achievements).values({ userId, achievementId: "chat_ai" });
    }
    if (action === "update_portfolio" && !earnedSet.has("portfolio_start")) {
      await db.insert(achievements).values({ userId, achievementId: "portfolio_start" });
    }
    if (newStreak >= 7 && !earnedSet.has("week_streak")) {
      await db.insert(achievements).values({ userId, achievementId: "week_streak" });
    }

    const { levelName, nextLevelPoints } = getLevelInfo(updated.points);
    const allAchievements = await db.select().from(achievements).where(eq(achievements.userId, userId));
    const achievedSet = new Set(allAchievements.map(a => a.achievementId));
    const achievementsList = ACHIEVEMENTS_LIST.map(a => ({
      id: a.id, name: a.name, description: a.description,
      earned: achievedSet.has(a.id),
      earnedAt: allAchievements.find(ua => ua.achievementId === a.id)?.earnedAt,
    }));
    res.json({ points: updated.points, streak: updated.streak, level, levelName, nextLevelPoints, achievements: achievementsList });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
