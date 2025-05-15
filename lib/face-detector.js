window.addEventListener("message", async function (event) {
  if (event.data && event.data.type === "CANVAS_PROCESS") {
    try {
      const imageId = event.data.imageId;

      // Get the image
      const img = document.getElementById(imageId);
      if (!img) {
        throw new Error("Image element not found");
      }

      // Initialize face detector
      const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
      const detector = await faceDetection.createDetector(model, {
        runtime: "tfjs",
        maxFaces: 5,
      });

      // Detect faces
      const faces = await detector.estimateFaces(img);

      // Create canvas
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");

      // Draw the original image
      ctx.drawImage(img, 0, 0);

      // Draw white rectangles on faces
      for (const face of faces) {
        const box = face.box;
        // Make the white overlay semi-transparent
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.fillRect(box.xMin, box.yMin, box.width, box.height);
      }

      // Get data URL
      const dataUrl = canvas.toDataURL("image/png");

      // Send result back with processed image data
      const resultMessage = {
        type: "CANVAS_RESULT",
        success: true,
        facesFound: faces.length,
        replacedCount: 0,
        processedImageData: dataUrl,
      };

      window.postMessage(resultMessage, "*");
    } catch (error) {
      // Send error back
      window.postMessage(
        {
          type: "CANVAS_RESULT",
          success: false,
          error: error.toString(),
        },
        "*"
      );
    }
  }
});
