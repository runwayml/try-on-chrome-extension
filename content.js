// Global variable to store the original image data
let lastOriginalImageData = null;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "processImage") {
    processImage(message.imageUrl)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we will send a response asynchronously
    return true;
  } else if (message.action === "getOriginalImage") {
    // Return the saved original image data if available
    if (lastOriginalImageData) {
      sendResponse({ success: true, originalImageData: lastOriginalImageData });
    } else {
      sendResponse({ success: false, error: "No original image available" });
    }
    return true;
  }
});

// Process the image
async function processImage(imageUrl) {
  try {
    // Request the image from the background script
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "fetchImage", imageUrl: imageUrl },
        resolve
      );
    });

    if (!response.success) {
      throw new Error("Failed to fetch image: " + response.error);
    }

    // Store the original image data
    lastOriginalImageData = response.imageData;

    // Load image into an Image element
    const img = await loadImage(response.imageData);

    // Create a unique ID for the image and add it to the DOM
    const imageId = "face-detection-image-" + Date.now();
    img.id = imageId;
    img.style.display = "none";
    document.body.appendChild(img);

    // Inject libraries
    await injectLibrary(
      chrome.runtime.getURL("vendor/tf.min.js"),
      "tensorflow-script"
    );
    await injectLibrary(
      chrome.runtime.getURL("vendor/face-detection.js"),
      "face-detection-script"
    );
    await injectLibrary(
      chrome.runtime.getURL("lib/face-detector.js"),
      "face-detector-script"
    );

    // Wait for libraries to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Set up listener for results
    const result = await new Promise((resolve, reject) => {
      // Set up window message listener
      const messageListener = (event) => {
        if (event.data && event.data.type === "CANVAS_RESULT") {
          window.removeEventListener("message", messageListener);

          if (event.data.success) {
            resolve({
              success: true,
              facesFound: event.data.facesFound,
              replacedCount: event.data.replacedCount,
              processedImageData: event.data.processedImageData,
            });
          } else {
            reject(new Error(event.data.error));
          }
        }
      };

      window.addEventListener("message", messageListener);

      // Send message to trigger face detection
      window.postMessage(
        {
          type: "CANVAS_PROCESS",
          imageId: imageId,
          originalUrl: imageUrl,
        },
        "*"
      );

      // Set timeout to prevent hanging
      setTimeout(() => {
        window.removeEventListener("message", messageListener);
        reject(new Error("Face detection timed out"));
      }, 30000);
    });

    // Clean up the image element
    if (document.getElementById(imageId)) {
      document.getElementById(imageId).remove();
    }

    return {
      success: true,
      replacedCount: result.replacedCount,
      processedImageData: result.processedImageData,
      originalImageData: lastOriginalImageData,
    };
  } catch (error) {
    throw error;
  }
}

// Function to inject a library into the page
function injectLibrary(src, id) {
  return new Promise((resolve, reject) => {
    // Check if the script is already in the page
    if (document.getElementById(id)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Helper function to load an image from a URL
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.crossOrigin = "anonymous"; // Important for canvas operations
    img.src = url;
  });
}
