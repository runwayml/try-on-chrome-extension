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
  // Create a single wardrobe item with the new image
  const wardrobeItem = {
    id: "wardrobe-" + Date.now(),
    data: imageData,
    timestamp: Date.now(),
  };

  // Save only this item to storage, replacing any existing ones
  chrome.storage.local.set({ wardrobeImages: [wardrobeItem] }, () => {
    // Notify sidepanel that wardrobe has updated
    chrome.runtime.sendMessage({
      action: "wardrobeUpdated",
    });
  });
}

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

async function startVideoGeneration(imageUrl, apiKey) {
  const response = await fetch(
    "https://api.dev.runwayml.com/v1/image_to_video",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-09-13",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        promptImage: imageUrl,
        seed: Math.floor(Math.random() * 1000000000),
        model: "gen3a_turbo",
        promptText: "Generate a video",
        watermark: false,
        duration: 5,
        ratio: "16:9",
      }),
    }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "Failed to start video generation");
  }
  return result.id;
}

async function pollForCompletion(taskId, apiKey) {
  const response = await fetch(
    `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-09-13",
      },
    }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "Failed to check task status");
  }

  if (result.status === "SUCCEEDED") {
    return result.output[0];
  } else if (result.status === "FAILED") {
    throw new Error("Video generation failed");
  } else {
    throw new Error("still_processing");
  }
}
