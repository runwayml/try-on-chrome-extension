chrome.runtime.onInstalled.addListener(() => {
  console.log("[Runway Virtual Try On] Extension installed, creating context menu");
  chrome.contextMenus.create({
    id: "try-on-runway",
    title: "Runway Virtual Try On",
    contexts: ["image"]
  });
});

// Setup sidepanel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Helper function to convert Blob to base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "try-on-runway") {
    console.log("[Runway Virtual Try On] Context menu clicked for image");
    
    // Open the side panel
    chrome.sidePanel.open({ tabId: tab.id });
    
    // Get the image URL from context menu
    const imageUrl = info.srcUrl;
    
    // Notify the sidepanel that processing has started with the original image URL
    chrome.runtime.sendMessage({
      action: "processingStarted",
      imageUrl: imageUrl
    });
    
    // Send message to content script to handle the image processing
    chrome.tabs.sendMessage(tab.id, {
      action: "processImage",
      imageUrl: imageUrl
    }, response => {
      // If successful, save the processed image to wardrobe
      if (response && response.success && response.processedImageData) {
        console.log("[Runway Virtual Try On] Saving processed image to wardrobe");
        saveImageToWardrobe(response.processedImageData);
      } else if (response && response.success) {
        // Fallback: use the original image if processed data is not available
        console.log("[Runway Virtual Try On] No processed image data, fetching original image instead");
        
        fetch(imageUrl, { mode: 'cors' })
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.blob();
          })
          .then(blob => blobToBase64(blob))
          .then(base64Data => {
            saveImageToWardrobe(base64Data);
          })
          .catch(error => {
            console.error('[Runway Virtual Try On] Error fetching original image:', error);
            // Notify sidepanel that processing failed
            chrome.runtime.sendMessage({
              action: "processingFailed",
              error: error.message
            });
          });
      } else {
        console.error("[Runway Virtual Try On] Failed to get processed image data");
        // Notify sidepanel that processing failed
        chrome.runtime.sendMessage({
          action: "processingFailed",
          error: response ? response.error : "Unknown error"
        });
      }
    });
  }
});

// Helper function to save an image to the wardrobe
function saveImageToWardrobe(imageData) {
  // Check storage usage
  chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
    console.log("[Runway Virtual Try On] Chrome storage usage:", bytesInUse, "bytes");
  });
  
  // Create a single wardrobe item with the new image
  const wardrobeItem = {
    id: 'wardrobe-' + Date.now(),
    data: imageData,
    timestamp: Date.now()
  };
  
  // Save only this item to storage, replacing any existing ones
  chrome.storage.local.set({ wardrobeImages: [wardrobeItem] }, () => {
    console.log("[Runway Virtual Try On] Image saved to wardrobe");
    // Notify sidepanel that wardrobe has updated
    chrome.runtime.sendMessage({
      action: "wardrobeUpdated"
    });
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Runway Virtual Try On] Background received message:", message.action);
  
  if (message.action === "fetchImage") {
    console.log("[Runway Virtual Try On] Fetching image from URL");
    
    fetch(message.imageUrl, { mode: 'cors' })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        return blobToBase64(blob);
      })
      .then(base64Data => {
        sendResponse({ 
          success: true, 
          imageData: base64Data 
        });
      })
      .catch(error => {
        console.error('[Runway Virtual Try On] Error fetching or processing image:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
  
  if (message.action === "processUploadedImage") {
    console.log("[Runway Virtual Try On] Processing uploaded image");
    
    // Get the image data from the message
    const imageData = message.imageData;
    const tabId = message.tabId;
    
    // Send message to content script to handle the image processing
    chrome.tabs.sendMessage(tabId, {
      action: "processImage",
      imageUrl: imageData
    }, response => {
      sendResponse(response);
    });
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
});
