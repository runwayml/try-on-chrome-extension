const RUNWAY_API_URL = 'https://api.dev.runwayml.com'


chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "try-on-runway",
    title: "Try on with Runway",
    contexts: ["image"],
  });
});

// Setup sidepanel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "try-on-runway") {
    // Open the side panel
    chrome.sidePanel.open({ tabId: tab.id });

    // Inject the content script first
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });


    // Wait for next tick to ensure side panel is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get the image URL from context menu
    const imageUrl = info.srcUrl;

    // Notify the sidepanel that processing has started with the original image URL
    chrome.runtime.sendMessage({
      action: "processingStarted",
      imageUrl: imageUrl,
    });

    // Send message to content script to handle the image processing
    chrome.tabs.sendMessage(
      tab.id,
      {
        action: "processImage",
        imageUrl: imageUrl,
      },
      (response) => {
        // If successful, save the processed image to wardrobe
        if (response && response.success && response.processedImageData) {
          saveImageToWardrobe(response.processedImageData);
        } else if (response && response.success) {
          // Fallback: use the original image if processed data is not available
          fetch(imageUrl, { mode: "cors" })
            .then((response) => {
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              return response.blob();
            })
            .then((blob) => blobToBase64(blob))
            .then((base64Data) => {
              saveImageToWardrobe(base64Data);
            })
            .catch((error) => {
              // Notify sidepanel that processing failed
              chrome.runtime.sendMessage({
                action: "processingFailed",
                error: error.message,
              });
            });
        } else {
          // Notify sidepanel that processing failed
          chrome.runtime.sendMessage({
            action: "processingFailed",
            error: response ? response.error : "Unknown error",
          });
        }
      }
    );
  }
});

// Helper function to save an image to the wardrobe
function saveImageToWardrobe(imageData) {
  // First get the original image URL
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    try {
      // Get the active tab
      const activeTab = tabs[0];
      const tabId = activeTab.id;

      // Ask the content script for the original image
      chrome.tabs.sendMessage(
        tabId,
        { action: "getOriginalImage" },
        async (response) => {
          let originalImageData = null;

          // If we got a response with the original image, use it
          if (response && response.success && response.originalImageData) {
            originalImageData = response.originalImageData;
          } else {
            // Otherwise just use the processed image as a fallback
            originalImageData = imageData;
          }

          // Create a single wardrobe item with both versions of the image
          const wardrobeItem = {
            id: "wardrobe-" + Date.now(),
            originalData: originalImageData, // Original image (no white square)
            processedData: imageData, // Processed image (with white square)
            timestamp: Date.now(),
          };

          // Save to storage
          chrome.storage.local.set({ wardrobeImages: [wardrobeItem] }, () => {
            // Notify sidepanel that wardrobe has updated
            chrome.runtime.sendMessage({
              action: "wardrobeUpdated",
            });
          });
        }
      );
    } catch (error) {
      console.error("Error saving to wardrobe:", error);

      // Fallback to just saving the processed image if there's an error
      const wardrobeItem = {
        id: "wardrobe-" + Date.now(),
        originalData: imageData, // Use same image as fallback
        processedData: imageData,
        timestamp: Date.now(),
      };

      chrome.storage.local.set({ wardrobeImages: [wardrobeItem] }, () => {
        chrome.runtime.sendMessage({
          action: "wardrobeUpdated",
        });
      });
    }
  });
}

// Create a single map to store request information
const requests = new Map();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchImage") {
    fetch(message.imageUrl, { mode: "cors" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        return blobToBase64(blob);
      })
      .then((base64Data) => {
        sendResponse({
          success: true,
          imageData: base64Data,
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we will send a response asynchronously
    return true;
  }

  // Handle image generation requests
  if (message.action === "startGeneration") {
    // Create a new AbortController for this request
    const controller = new AbortController();

    // Generate a unique ID for this request (background's internal key)
    const bgRequestId = Date.now().toString();

    // Store the controller with the request ID and status
    requests.set(bgRequestId, {
      controller,
      status: "pending",
      taskId: null,
      clientRequestId: message.clientRequestId, // Store clientRequestId from message
    });

    startGeneration(
      message.profileImage,
      message.imageUrl,
      message.apiKey,
      controller.signal
    ) // This is the async API call wrapper
      .then((apiTaskId) => {
        // Update the request entry with the taskId
        const request = requests.get(bgRequestId);
        if (request) {
          request.taskId = apiTaskId;
          request.status = "active";
        }
        // Respond with API's taskId and background's internal requestId (map key)
        sendResponse({
          success: true,
          taskId: apiTaskId,
          requestId: bgRequestId,
        });
      })
      .catch((error) => {
        // Clean up the request
        requests.delete(bgRequestId);

        if (error.name === "AbortError") {
          sendResponse({
            success: false,
            error: "Request was cancelled",
            aborted: true,
            requestId: bgRequestId, // Include bgRequestId in response for consistency
          });
        } else {
          sendResponse({
            success: false,
            error: error.message,
            requestId: bgRequestId,
          }); // Include bgRequestId
        }
      });
    return true;
  }

  // Handle polling for generation results
  if (message.action === "pollForCompletion") {
    // Find the request by taskId
    let requestEntry = null;
    let requestId = null;

    // Find the request with matching taskId
    for (const [id, request] of requests.entries()) {
      if (request.taskId === message.taskId) {
        requestEntry = request;
        requestId = id;
        break;
      }
    }

    if (!requestEntry || !requestEntry.controller) {
      sendResponse({
        success: false,
        error: "No active controller for this task",
      });
      return true;
    }

    pollForCompletion(
      message.taskId,
      message.apiKey,
      requestEntry.controller.signal
    )
      .then((imageUrl) => {
        // Clean up the controller when done
        requests.delete(requestId);
        sendResponse({ success: true, imageUrl });
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          requests.delete(requestId);
          sendResponse({
            success: false,
            error: "Polling was cancelled",
            aborted: true,
          });
        } else if (error.message === "still_processing") {
          sendResponse({ success: false, error: "still_processing" });
        } else {
          // Clean up the controller on error
          requests.delete(requestId);
          sendResponse({ success: false, error: error.message });
        }
      });
    return true;
  }

  // Add handler for cancellation
  if (message.action === "cancelGeneration") {
    const { taskId, requestId: messageBgRequestId, clientRequestId } = message;
    let processed = false;
    let keyToDeleteFromMap = null;

    // Try to find the request to cancel
    // Option 1: Sidepanel sent its clientRequestId (most reliable for early cancellation)
    if (clientRequestId) {
      for (const [bgKey, req] of requests.entries()) {
        if (req.clientRequestId === clientRequestId) {
          if (req.controller) req.controller.abort();
          keyToDeleteFromMap = bgKey;
          processed = true;
          break;
        }
      }
    }

    // Option 2: Sidepanel sent the background's requestId (if it received it and clientRequestId didn't match/wasn't sent)
    if (!processed && messageBgRequestId && requests.has(messageBgRequestId)) {
      const request = requests.get(messageBgRequestId);
      if (request.controller) request.controller.abort();
      keyToDeleteFromMap = messageBgRequestId;
      processed = true;
    }

    // Option 3: Sidepanel sent taskId (if it received it and previous methods didn't match/weren't sent)
    if (!processed && taskId) {
      for (const [bgKey, req] of requests.entries()) {
        if (req.taskId === taskId) {
          if (req.controller) req.controller.abort();
          keyToDeleteFromMap = bgKey;
          processed = true;
          break;
        }
      }
    }

    if (keyToDeleteFromMap) {
      requests.delete(keyToDeleteFromMap);
    }

    sendResponse(
      processed
        ? { success: true }
        : { success: false, error: "No active request found to cancel" }
    );
    return true;
  }
});

// Helper function to convert Blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function startGeneration(profileImage, imageUrl, apiKey, signal) {
  try {
    // Make sure the signal is not aborted before starting
    if (signal && signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const controller = new AbortController();
    const combinedSignal = controller.signal;

    // Forward the original abort signal to our new controller
    if (signal) {
      signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    const response = await fetch(
      `${RUNWAY_API_URL}/v1/text_to_image`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Runway-Version": "2024-11-06",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          promptText: "IMG_1 wearing IMG_2",
          model: "gen4_image",
          ratio: "1080:1440", // 3:4
          referenceImages: [
            {
              uri: profileImage,
            },
            { uri: imageUrl },
          ],
        }),
        signal: combinedSignal, // Use our combined signal
      }
    );

    // Check if the operation has been aborted after the fetch completed
    if (signal && signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Failed to start generation");
    }
    return result.id;
  } catch (error) {
    // Ensure that AbortError is properly identified and propagated
    if (error.name === "AbortError" || (signal && signal.aborted)) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    throw error; // Re-throw to be handled by caller
  }
}

async function pollForCompletion(taskId, apiKey, signal) {
  try {
    // Make sure the signal is not aborted before starting
    if (signal && signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const controller = new AbortController();
    const combinedSignal = controller.signal;

    // Forward the original abort signal to our new controller
    if (signal) {
      signal.addEventListener("abort", () => {
        controller.abort();
      });
    }

    const response = await fetch(
      `${RUNWAY_API_URL}/v1/tasks/${taskId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Runway-Version": "2024-09-13",
        },
        signal: combinedSignal, // Use our combined signal
      }
    );

    // Check if the operation has been aborted after the fetch completed
    if (signal && signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Failed to check task status");
    }

    if (result.status === "SUCCEEDED") {
      return result.output[0];
    } else if (result.status === "FAILED") {
      throw new Error("Generation failed");
    } else {
      throw new Error("still_processing");
    }
  } catch (error) {
    // Ensure that AbortError is properly identified and propagated
    if (error.name === "AbortError" || (signal && signal.aborted)) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    throw error; // Re-throw to be handled by caller
  }
}
