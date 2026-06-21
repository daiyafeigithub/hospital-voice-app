// 一次性脚本：将 public/respiratory-response.mp4 转为 H.264（浏览器可播）
// 用法：node convert-video.mjs
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = join(__dirname, "public", "respiratory-response.mp4");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

console.log("Converting H.265 → H.264...");

ffmpeg(INPUT)
  .outputOptions([
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
  ])
  .output(INPUT + ".tmp.mp4")
  .on("progress", (info) => {
    process.stdout.write(`\rTranscoding... ${info.percent ? Math.round(info.percent) : "?"}%`);
  })
  .on("end", async () => {
    // 替换原文件
    const { rename, unlink } = await import("fs/promises");
    await unlink(INPUT);
    await rename(INPUT + ".tmp.mp4", INPUT);
    console.log("\nDone! Video converted to H.264 ✅");
    process.exit(0);
  })
  .on("error", (err) => {
    console.error("\nError:", err.message);
    process.exit(1);
  })
  .run();
