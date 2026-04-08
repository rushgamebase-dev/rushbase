#!/usr/bin/env node
/**
 * Browser-level timing validation using Puppeteer.
 *
 * Intercepts WebSocket BEFORE React mounts, so we capture every message.
 * Hooks into AudioContext to detect exact beep time.
 * Polls DOM to detect exact count repaint time.
 *
 * Measures:
 *   1. backend detection ts → browser WS receive
 *   2. browser WS receive → React state update (DOM change)
 *   3. browser WS receive → beep scheduled (AudioContext.start)
 */

const puppeteer = require("puppeteer");

const FRONTEND_URL = "http://localhost:3002";
const OBSERVE_SECONDS = 45;

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  const page = await browser.newPage();

  // === STEP 1: Install hooks BEFORE page loads ===
  await page.evaluateOnNewDocument(() => {
    window.__timing = {
      wsRecv: [],      // { count, backendTs, recvTs }
      domChange: [],   // { count, domTs }
      beepFired: [],   // { beepTs, audioTime }
    };

    // --- Intercept WebSocket ---
    const OrigWS = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new OrigWS(...args);

      const origSet = Object.getOwnPropertyDescriptor(OrigWS.prototype, "onmessage").set;
      let userHandler = null;

      Object.defineProperty(ws, "onmessage", {
        get() { return userHandler; },
        set(fn) {
          userHandler = fn;
          origSet.call(ws, function (event) {
            // Intercept before React handler
            if (typeof event.data === "string") {
              try {
                const msg = JSON.parse(event.data);
                if (msg.type === "vehicle_counted" || msg.type === "count") {
                  const recvTs = performance.now();
                  window.__timing.wsRecv.push({
                    type: msg.type,
                    count: msg.count,
                    backendTs: msg.ts || 0,
                    recvTs,
                    recvDate: Date.now(),
                  });
                }
              } catch {}
            }
            // Call React handler
            fn.call(ws, event);
          });
        },
      });

      return ws;
    };
    Object.assign(window.WebSocket, OrigWS);
    window.WebSocket.prototype = OrigWS.prototype;

    // --- Intercept AudioContext (beep detection) ---
    const OrigAudioCtx = window.AudioContext || window.webkitAudioContext;
    if (OrigAudioCtx) {
      const origStart = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (when) {
        window.__timing.beepFired.push({
          beepTs: performance.now(),
          beepDate: Date.now(),
          audioTime: when || 0,
        });
        return origStart.call(this, when);
      };
    }

    // --- DOM poller (started after page load) ---
    window.__lastDomCount = -1;
    setTimeout(() => {
      setInterval(() => {
        const els = document.querySelectorAll(".tabular-nums");
        for (const el of els) {
          const text = el.textContent.trim();
          if (/^\d{3}$/.test(text)) {
            const count = parseInt(text, 10);
            if (count !== window.__lastDomCount) {
              window.__timing.domChange.push({
                count,
                domTs: performance.now(),
                domDate: Date.now(),
              });
              window.__lastDomCount = count;
            }
            break;
          }
        }
      }, 20); // 20ms = 50Hz polling
    }, 3000);
  });

  // === STEP 2: Navigate and dismiss overlay ===
  console.log(`Navigating to ${FRONTEND_URL}...`);
  await page.goto(FRONTEND_URL, { waitUntil: "networkidle2", timeout: 30000 });

  // Click to dismiss WelcomeOverlay + unlock audio
  await page.evaluate(() => {
    const btns = document.querySelectorAll("button");
    for (const b of btns) {
      if (b.textContent.includes("GOT IT")) { b.click(); break; }
    }
    document.body.click(); // unlock AudioContext
  });

  console.log(`Observing for ${OBSERVE_SECONDS}s...`);
  await new Promise((r) => setTimeout(r, OBSERVE_SECONDS * 1000));

  // === STEP 3: Collect results ===
  const timing = await page.evaluate(() => window.__timing);

  await browser.close();

  // === STEP 4: Analyze ===
  console.log("\n" + "=".repeat(70));
  console.log("BROWSER TIMING VALIDATION REPORT");
  console.log("=".repeat(70));

  const { wsRecv, domChange, beepFired } = timing;

  // Filter vehicle_counted only
  const vcRecv = wsRecv.filter((e) => e.type === "vehicle_counted");
  const countRecv = wsRecv.filter((e) => e.type === "count");

  console.log(`\nRaw data:`);
  console.log(`  WS messages received: ${wsRecv.length} (${vcRecv.length} vehicle_counted, ${countRecv.length} count)`);
  console.log(`  DOM count changes: ${domChange.length}`);
  console.log(`  Beep oscillators started: ${beepFired.length}`);

  // --- 1. Backend detection → browser WS receive ---
  console.log(`\n--- 1. Detection → Browser WS Receive ---`);
  if (vcRecv.length > 0) {
    const latencies = vcRecv
      .filter((e) => e.backendTs > 0)
      .map((e) => e.recvDate - e.backendTs * 1000);

    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const med = latencies[Math.floor(latencies.length / 2)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      console.log(`  Samples: ${latencies.length}`);
      console.log(`  avg=${avg.toFixed(0)}ms  median=${med.toFixed(0)}ms  p95=${p95.toFixed(0)}ms  max=${Math.max(...latencies).toFixed(0)}ms`);
    }

    console.log(`\n  First 5 events:`);
    for (const e of vcRecv.slice(0, 5)) {
      const lat = e.backendTs > 0 ? (e.recvDate - e.backendTs * 1000).toFixed(0) : "?";
      console.log(`    count=${e.count}  backendTs=${e.backendTs.toFixed(3)}  recvDate=${new Date(e.recvDate).toISOString()}  latency=${lat}ms`);
    }
  } else {
    console.log("  NO vehicle_counted events received in browser!");
  }

  // --- 2. WS receive → DOM repaint ---
  console.log(`\n--- 2. WS Receive → DOM Count Change ---`);
  if (vcRecv.length > 0 && domChange.length > 0) {
    // Match by temporal proximity: for each vehicle_counted, find the FIRST
    // DOM change that happened AFTER it, regardless of count value.
    // This avoids the bug where count message updates DOM with same value later.
    const recvToDomLatencies = [];
    let domIdx = 0;

    for (const vc of vcRecv) {
      // Advance domIdx past any DOM changes that happened before this WS recv
      while (domIdx < domChange.length && domChange[domIdx].domTs < vc.recvTs) {
        domIdx++;
      }
      // The next DOM change after WS recv is the one triggered by this event
      if (domIdx < domChange.length) {
        const latMs = domChange[domIdx].domTs - vc.recvTs;
        if (latMs >= 0 && latMs < 2000) {
          recvToDomLatencies.push({ count: vc.count, domCount: domChange[domIdx].count, latMs });
          domIdx++;
        }
      }
    }

    console.log(`  Matched (WS event → next DOM change): ${recvToDomLatencies.length}/${vcRecv.length}`);
    if (recvToDomLatencies.length > 0) {
      const lats = recvToDomLatencies.map((e) => e.latMs).sort((a, b) => a - b);
      const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
      const med = lats[Math.floor(lats.length / 2)];
      const p95 = lats[Math.floor(lats.length * 0.95)];
      console.log(`  WS recv → DOM change: avg=${avg.toFixed(1)}ms  median=${med.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  max=${Math.max(...lats).toFixed(1)}ms`);
      console.log(`\n  First 5:`);
      for (const e of recvToDomLatencies.slice(0, 5)) {
        console.log(`    count=${e.count}  domCount=${e.domCount}  wsRecv→dom=${e.latMs.toFixed(1)}ms`);
      }
    }
  } else {
    console.log("  Cannot match — missing WS or DOM data");
  }

  // --- 3. WS receive → Beep ---
  console.log(`\n--- 3. WS Receive → Beep Fired ---`);
  if (vcRecv.length > 0 && beepFired.length > 0) {
    // Beeps fire in order of vehicle_counted events
    // Match by temporal proximity (beep should follow WS recv within ~50ms)
    let matchCount = 0;
    const recvToBeepLatencies = [];
    let beepIdx = 0;

    for (const vc of vcRecv) {
      // Find next beep that happened after this WS recv
      while (beepIdx < beepFired.length && beepFired[beepIdx].beepTs < vc.recvTs) {
        beepIdx++;
      }
      if (beepIdx < beepFired.length) {
        const latMs = beepFired[beepIdx].beepTs - vc.recvTs;
        if (latMs >= 0 && latMs < 1000) {
          recvToBeepLatencies.push({ count: vc.count, latMs });
          matchCount++;
          beepIdx++;
        }
      }
    }

    console.log(`  Matched (WS event → beep): ${matchCount}/${vcRecv.length}`);
    if (recvToBeepLatencies.length > 0) {
      const lats = recvToBeepLatencies.map((e) => e.latMs).sort((a, b) => a - b);
      const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
      const med = lats[Math.floor(lats.length / 2)];
      const p95 = lats[Math.floor(lats.length * 0.95)];
      console.log(`  WS recv → beep: avg=${avg.toFixed(1)}ms  median=${med.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  max=${Math.max(...lats).toFixed(1)}ms`);
      console.log(`\n  First 5:`);
      for (const e of recvToBeepLatencies.slice(0, 5)) {
        console.log(`    count=${e.count}  wsRecv→beep=${e.latMs.toFixed(1)}ms`);
      }
    }
  } else {
    console.log(`  Cannot match — beeps: ${beepFired.length}, WS events: ${vcRecv.length}`);
    if (beepFired.length === 0) {
      console.log("  NOTE: AudioContext may be suspended (no user gesture in headless)");
    }
  }

  // --- 4. End-to-end: detection → DOM ---
  console.log(`\n--- 4. End-to-End: Backend Detection → DOM Change ---`);
  if (vcRecv.length > 0 && domChange.length > 0) {
    // Temporal matching: for each vehicle_counted, find next DOM change after
    // the backend detection time (using Date.now/domDate for cross-reference)
    const e2eLatencies = [];
    let dIdx = 0;

    for (const vc of vcRecv) {
      if (vc.backendTs <= 0) continue;
      const detectDate = vc.backendTs * 1000; // backend ts in ms

      // Find first DOM change after detection
      while (dIdx < domChange.length && domChange[dIdx].domDate < detectDate) {
        dIdx++;
      }
      if (dIdx < domChange.length) {
        const e2e = domChange[dIdx].domDate - detectDate;
        if (e2e >= 0 && e2e < 2000) {
          e2eLatencies.push({ count: vc.count, domCount: domChange[dIdx].count, e2e });
          dIdx++;
        }
      }
    }

    if (e2eLatencies.length > 0) {
      const lats = e2eLatencies.map((e) => e.e2e).sort((a, b) => a - b);
      const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
      const med = lats[Math.floor(lats.length / 2)];
      const p95 = lats[Math.floor(lats.length * 0.95)];
      console.log(`  Matched: ${e2eLatencies.length}`);
      console.log(`  Detection → DOM: avg=${avg.toFixed(0)}ms  median=${med.toFixed(0)}ms  p95=${p95.toFixed(0)}ms  max=${Math.max(...lats).toFixed(0)}ms`);
      console.log(`\n  First 5:`);
      for (const e of e2eLatencies.slice(0, 5)) {
        console.log(`    count=${e.count}  domCount=${e.domCount}  detection→dom=${e.e2e.toFixed(0)}ms`);
      }
    }
  }

  // --- Verdict ---
  console.log(`\n${"=".repeat(70)}`);

  const issues = [];
  if (vcRecv.length === 0) issues.push("No vehicle_counted events in browser");
  if (domChange.length === 0) issues.push("No DOM count changes detected");
  if (beepFired.length === 0) issues.push("No beeps detected (AudioContext may be suspended in headless)");

  if (issues.length > 0) {
    console.log(`ISSUES (${issues.length}):`);
    for (const i of issues) console.log(`  - ${i}`);
  } else {
    console.log("VERDICT: All browser timing validated");
  }
  console.log("=".repeat(70));
})();
