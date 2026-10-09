// Runs before `npm run dev`. A second dev server used to slip onto 3001 while
// an old one stayed on 3000; both wrote into the same .next folder and the old
// one started serving pages without their CSS. The dev script now pins 3000, so
// a second start fails anyway - this only makes the failure say what to do.
import net from "node:net";
import { execSync } from "node:child_process";

const PORT = 3000;

function pidOnPort(port) {
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const line = out
      .split(/\r?\n/)
      .find((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l));
    return line ? line.trim().split(/\s+/).pop() : null;
  } catch {
    return null;
  }
}

const probe = net.createServer();
probe.once("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  const pid = pidOnPort(PORT);
  console.error(`\nPort ${PORT} is already in use - the app is probably running already.`);
  console.error(`Open http://localhost:${PORT} instead of starting another copy.`);
  if (pid) console.error(`To stop the old one first:  Stop-Process -Id ${pid}`);
  console.error("");
  process.exit(1);
});
probe.once("listening", () => probe.close());
probe.listen(PORT);
