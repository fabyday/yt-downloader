import { startWorker } from "./WorkerServer";

void startWorker().catch((error) => {
  console.error("Failed to start yt-downloader worker", error);
  process.exitCode = 1;
});
