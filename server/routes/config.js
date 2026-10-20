import express from "express";
import { col } from "../db.js";
import { requireAuth } from "../middleware.js";

const router = express.Router();

router.get("/config", requireAuth, async (_req, res) => {
  const prefs = await col("prefs").findOne({ _id: "singleton" });
  res.json({
    siteName: prefs?.siteName || "CineVault",
    accentColor: prefs?.accentColor || "#e50914",
  });
});

export default router;
