const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();
const port = 5000;

app.use(cors());

const upload = multer({ dest: "uploads/" });

app.post("/upload", upload.array("files"), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send({ message: "No files uploaded" });
  }

  const outputFilePath = path.join(__dirname, "uploads", "merged_output.mp3");
  const mergedAudio = ffmpeg();

  req.files.forEach((file) => {
    mergedAudio.input(file.path);
  });

  mergedAudio
    .on("error", (err) => {
      console.error("Error:", err);
      res.status(500).send({ message: "Error merging files" });
    })
    .on("end", () => {
      req.files.forEach((file) => fs.unlinkSync(file.path));
      res.download(outputFilePath, "merged_output.mp3", (err) => {
        if (err) {
          console.error("Error sending file:", err);
          res.status(500).send({ message: "Error sending merged file" });
        } else {
          fs.unlinkSync(outputFilePath);
        }
      });
    })
    .mergeToFile(outputFilePath);
});

// api for video+audio merge

app.post(
  "/merge-video-audio",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  (req, res) => {
    if (!req.files || !req.files.video || !req.files.audio) {
      return res
        .status(400)
        .json({ error: "Both video and audio files are required." });
    }

    const videoPath = req.files.video[0].path;
    const audioPath = req.files.audio[0].path;
    const mergedDir = "merged";
    const mergedFilePath = path.join(mergedDir, `merged_${Date.now()}.mp4`);

    if (!fs.existsSync(mergedDir)) {
      fs.mkdirSync(mergedDir);
    }

    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .complexFilter(
        `[1:a]adelay=${0 * 1000}|${0 * 1000}[a1];[0:a][a1]amix=inputs=2`
      )
      .outputOptions("-c:v copy")
      .outputOptions("-c:a aac")
      .output(mergedFilePath)
      .on("end", () => {
        res.sendFile(path.resolve(mergedFilePath), () => {
          fs.unlinkSync(videoPath);
          fs.unlinkSync(audioPath);
          fs.unlinkSync(mergedFilePath);
        });
      })
      .on("error", (err) => {
        console.error("Error merging files:", err);
        res
          .status(500)
          .json({ error: "An error occurred while merging files." });
      })
      .run();
  }
);

app.post("/merge-multiple-videos", upload.array("videos"), (req, res) => {
  if (!req.files || req.files.length < 2) {
    return res
      .status(400)
      .send({ message: "At least two video files required" });
  }
  const outputFilePath = path.join(
    __dirname,
    "uploads",
    `merged_videos_${Date.now()}.mp4`
  );

  const mergedVideo = ffmpeg();

  req.files.forEach((file) => {
    mergedVideo.input(file.path);
  });

  mergedVideo
    .on("error", (err) => {
      console.error("Error merging video files:", err);
      req.files.forEach((file) => fs.unlinkSync(file.path));
      res.status(500).send({ message: "Error merging video files" });
    })
    .on("end", () => {
      req.files.forEach((file) => fs.unlinkSync(file.path));

      const readStream = fs.createReadStream(outputFilePath);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="merged_videos.mp4"`
      );
      readStream.pipe(res);

      readStream.on("end", () => {
        fs.unlinkSync(outputFilePath);
      });

      readStream.on("error", (err) => {
        console.error("Error sending merged file:", err);
        res.status(500).send({ message: "Error sending merged file" });
        fs.unlinkSync(outputFilePath);
      });
    })
    .mergeToFile(outputFilePath);
});



// video trim api
app.post("/trim-video", upload.single("video"), (req, res) => {
  const { startTime, endTime } = req.body;
  const inputPath = req.file.path;
  const outputPath = path.join("uploads", `trimmed_${req.file.originalname}`);

  ffmpeg(inputPath)
    .setStartTime(startTime)
    .setDuration(endTime)
    .output(outputPath)
    .on("end", () => {
      res.download(outputPath, (err) => {
        if (err) {
          console.error("Error downloading file:", err);
          res.status(500).send("Error downloading file.");
        }
        fs.unlinkSync(inputPath);
        fs.unlinkSync(outputPath);
      });
    })
    .on("error", (err) => {
      console.error("Error trimming video:", err);
      res.status(500).send("Error trimming video.");
    })
    .run();
});

app.post(
  "/merge-video-background-audio",
  upload.fields([{ name: "video" }, { name: "audio" }]),
  (req, res) => {
    const videoFile = req.files.video[0];
    const audioFile = req.files.audio[0];
    const audioLevel = parseInt(req.body.audioLevel) || 50;
    const outputFilePath = path.join(
      __dirname,
      "uploads",
      `merged_${Date.now()}.mp4`
    );

    const audioVolume = audioLevel / 100;

    ffmpeg.ffprobe(videoFile.path, (err, videoMetadata) => {
      if (err) {
        console.error("Error reading video file metadata:", err);
        return res.status(500).send("Error processing video file");
      }

      const videoDuration = videoMetadata.format.duration;

      ffmpeg.ffprobe(audioFile.path, (err, audioMetadata) => {
        if (err) {
          console.error("Error reading audio file metadata:", err);
          return res.status(500).send("Error processing audio file");
        }

        const audioDuration = audioMetadata.format.duration;
        const audioLoopCount = Math.ceil(videoDuration / audioDuration);

        const loopedAudioFilePath = path.join(
          __dirname,
          "uploads",
          `looped_${Date.now()}.mp3`
        );

        ffmpeg()
          .input(audioFile.path)
          .inputOptions([
            `-stream_loop ${audioLoopCount - 1}`,
            `-t ${videoDuration}`,
          ])
          .output(loopedAudioFilePath)
          .on("end", () => {
            ffmpeg()
              .addInput(videoFile.path)
              .addInput(loopedAudioFilePath)
              .audioFilters(`volume=${audioVolume}`)
              .output(outputFilePath)
              .on("end", () => {
                res.download(outputFilePath, "merged_output.mp4", (err) => {
                  if (err) {
                    console.error("Error downloading file:", err);
                  }
                  fs.unlink(videoFile.path, () => {});
                  fs.unlink(audioFile.path, () => {});
                  fs.unlink(loopedAudioFilePath, () => {});
                  fs.unlink(outputFilePath, () => {});
                });
              })
              .on("error", (err) => {
                console.error("Error merging video and background audio:", err);
                res
                  .status(500)
                  .send("Error merging video and background audio");
                fs.unlink(videoFile.path, () => {});
                fs.unlink(audioFile.path, () => {});
                fs.unlink(loopedAudioFilePath, () => {});
              })
              .run();
          })
          .on("error", (err) => {
            console.error("Error creating looped audio:", err);
            res.status(500).send("Error processing audio file");
            fs.unlink(audioFile.path, () => {});
          })
          .run();
      });
    });
  }
);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
