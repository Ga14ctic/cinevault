import express from "express";
import { col } from "../db.js";
import { requireAuth, requireRoot } from "../middleware.js";

const router = express.Router();

router.get("/config", requireAuth, async (_req, res) => {
  const prefs = await col("prefs").findOne({ _id: "singleton" });
  const c = prefs?.cinesrc || {};
  res.json({
    siteName: prefs?.siteName || "CineVault",
    cinesrc: {
      color: c.color || "#e50914",
      autoplay: c.autoplay !== false,
      autonext: c.autonext !== false,
      autoskip: c.autoskip === true,
      seek: c.seek ?? 10,
      quality: c.quality || null,
      febboxToken: c.febboxToken || "",
    },
  });
});

router.get("/admin/prefs", requireRoot, async (_req, res) => {
  const prefs = await col("prefs").findOne({ _id: "singleton" });
  res.json({ prefs });
});

export default router;
