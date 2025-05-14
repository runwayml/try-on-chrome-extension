// Face detection worker script
console.log("[Runway Virtual Try On – Page] Face detector script loaded");

// Listen for messages
window.addEventListener('message', async function(event) {
  // Verify origin
  if (event.data && event.data.type === 'CANVAS_PROCESS') {
    try {
      console.log("[Runway Virtual Try On – Page] Starting face detection");
      const imageId = event.data.imageId;
      
      // Get the image
      const img = document.getElementById(imageId);
      if (!img) {
        throw new Error("Image element not found");
      }
      
      console.log("[Runway Virtual Try On – Page] Image dimensions:", img.width, "x", img.height);
      
      // Initialize face detector
      const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
      const detector = await faceDetection.createDetector(model, {
        runtime: 'tfjs',
        maxFaces: 5,
      });
      console.log("[Runway Virtual Try On – Page] Face detector initialized");
      
      // Detect faces
      const faces = await detector.estimateFaces(img);
      console.log("[Runway Virtual Try On – Page] Found", faces.length, "faces");
      
      // Log face details
      faces.forEach((face, index) => {
        console.log(`[Runway Virtual Try On – Page] Face #${index+1} details:`, {
          box: face.box,
          landmarks: face.landmarks,
          probability: face.probability
        });
      });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      // Draw the original image
      ctx.drawImage(img, 0, 0);
      console.log("[Runway Virtual Try On – Page] Drew original image to canvas");
      
      // Draw white rectangles on faces
      for (const face of faces) {
        const box = face.box;
        console.log("[Runway Virtual Try On – Page] Drawing rectangle at:", {
          x: box.xMin,
          y: box.yMin,
          width: box.width,
          height: box.height
        });
        
        // Make the white overlay semi-transparent
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(box.xMin, box.yMin, box.width, box.height);
      }
      
      // Get data URL
      const dataUrl = canvas.toDataURL('image/png');
      
      // Log a preview of the data URL
      console.log("[Runway Virtual Try On – Page] Generated base64 image");
      
      // Send result back with processed image data
      const resultMessage = {
        type: 'CANVAS_RESULT',
        success: true,
        facesFound: faces.length,
        replacedCount: 0,
        processedImageData: dataUrl
      };
      
      console.log("[Runway Virtual Try On – Page] Sending result");
      window.postMessage(resultMessage, '*');
      
    } catch (error) {
      console.error("[Runway Virtual Try On – Page] Error:", error);
      
      // Send error back
      window.postMessage({
        type: 'CANVAS_RESULT',
        success: false,
        error: error.toString()
      }, '*');
    }
  }
}); 