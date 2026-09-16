"use strict";

/**
 * Express application.
 *
 * The middleware chain, in order. This order is the architecture: read it top
 * to bottom and you have SDD 4.1's cross-cutting modules in sequence.
 *
 *   1  CORS               allow the web app's origin, with credentials
 *   2  body parsing
 *   3  cookie parsing
 *   4  attachAudit        req.audit() available everywhere          REQ-9
 *   5  loadActor          session cookie -> req.actor               REQ-4
 *   ---------------------------------------------------------------
 *   6  routes             each applies requireClubContext           REQ-13
 *                         and authorize(...)                        REQ-8
 *   ---------------------------------------------------------------
 *   7  notFoundHandler
 *   8  errorHandler
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const { env } = require("./config/env");
const { attachAudit } = require("./middleware/audit");
const { loadActor } = require("./middleware/authenticate");
const { notFoundHandler, errorHandler, asyncRoute } = require("./middleware/errors");
const { healthcheck } = require("./db/pool");

const authRoutes = require("./modules/auth/auth.routes");
const clubRoutes = require("./modules/clubs/clubs.routes");
const memberRoutes = require("./modules/members/members.routes");
const contributionRoutes = require("./modules/contributions/contributions.routes");

function createApp() {
    const app = express();

    // Behind a proxy (Render, Railway, Fly) this makes req.secure and the
    // X-Forwarded-For address trustworthy, which the audit log depends on.
    app.set("trust proxy", 1);
    app.disable("x-powered-by");

    // 1. CORS. The web app runs on a different origin, so the cookie is
    //    cross-origin and the origin must be named exactly — a wildcard is not
    //    permitted alongside credentials.
    app.use(cors({
        origin: env.WEB_ORIGIN,
        credentials: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    }));

    // 2, 3.
    app.use(express.json({ limit: "1mb" }));
    app.use(cookieParser());

    // 4, 5.
    app.use(attachAudit);
    app.use(loadActor);

    // Liveness. Useful on demonstration day: if this returns, the server is up
    // and the database is reachable, and you know immediately which half of the
    // system is the problem.
    app.get("/api/health", asyncRoute(async (req, res) => {
        const db = await healthcheck();
        res.json({ ok: true, service: "stokvel-admin-system", database: db });
    }));

    // 6. Feature routes. Others are mounted here as each step lands.
    app.use("/api/auth", authRoutes);
    app.use("/api/club", clubRoutes);
    app.use("/api/members", memberRoutes);
    app.use("/api/cycles", contributionRoutes.cycles);
    app.use("/api/contributions", contributionRoutes.contributions);
    app.use("/api/ledger", contributionRoutes.ledger);

    // 7, 8.
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };