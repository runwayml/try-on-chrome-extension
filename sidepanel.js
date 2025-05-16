(function () {
  // Elements
  const dropArea = document.getElementById("drop-area");
  const fileInput = document.getElementById("file-input");
  const previewContainer = document.getElementById("preview-container");
  const previewImage = document.getElementById("preview-image");
  const removeImageBtn = document.getElementById("remove-image-btn");
  const wardrobeContainer = document.getElementById("wardrobe-container");
  const itemTemplate = document.getElementById("wardrobe-item-template");
  const tryOnBtn = document.getElementById("try-on-btn");
  const apiKeyInput = document.getElementById("api-key-input");

  // Listen for messages from background script about wardrobe updates
  chrome.runtime.onMessage.addListener(async (message) => {
    if (message.action === "wardrobeUpdated") {
      // Reload wardrobe items from storage
      loadWardrobeItems();
      // Find and remove any loading items
      const loadingItems = wardrobeContainer.querySelectorAll(
        ".wardrobe-item.is-loading"
      );
      loadingItems.forEach((item) => item.remove());

      // Check storage to determine Try On button state
      updateTryOnButtonState();
    } else if (message.action === "processingStarted") {
      // Clear existing wardrobe items first
      wardrobeContainer.innerHTML = "";
      // Add loading item to wardrobe
      addLoadingItem(message.imageUrl);
    } else if (message.action === "processingFailed") {
      // Remove any loading items
      const loadingItems = wardrobeContainer.querySelectorAll(
        ".wardrobe-item.is-loading"
      );
      loadingItems.forEach((item) => item.remove());

      // Check if we need to show the empty state
      if (wardrobeContainer.children.length === 0) {
        showEmptyState();
        // Update Try On button state
        updateTryOnButtonState();
      }

      // Show error message
      alert(`Processing failed: ${message.error}`);
    }
  });

  // Remove image button click
  removeImageBtn.addEventListener("click", removeImage);

  // API key input change handler
  apiKeyInput.addEventListener("input", function () {
    // Save the API key to storage
    chrome.storage.local.set({ apiKey: this.value }, () => {
      // Update Try On button state
      updateTryOnButtonState();
    });
  });

  // Helper function to update the Try On button state
  function updateTryOnButtonState() {
    chrome.storage.local.get(
      { wardrobeImages: [], apiKey: "", userProfileImage: null },
      (result) => {
        // Enable the Try On button only if all required elements are present
        tryOnBtn.disabled =
          result.wardrobeImages.length === 0 ||
          !result.apiKey ||
          !result.userProfileImage;
      }
    );
  }

  // Load saved API key from storage
  function loadApiKey() {
    chrome.storage.local.get({ apiKey: "" }, (result) => {
      apiKeyInput.value = result.apiKey;
    });
  }

  // Call to load API key on startup
  loadApiKey();

  // Prevent default drag behaviors
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropArea.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  // Highlight drop area when item is dragged over it
  ["dragenter", "dragover"].forEach((eventName) => {
    dropArea.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropArea.addEventListener(eventName, unhighlight, false);
  });

  // Handle dropped files
  dropArea.addEventListener("drop", handleDrop, false);

  // Handle click on drop area
  dropArea.addEventListener("click", () => {
    fileInput.click();
  });

  // Handle file selection
  fileInput.addEventListener("change", handleFiles);

  // Load wardrobe items from storage on startup
  loadWardrobeItems();

  // Initialize the Try On button state
  updateTryOnButtonState();

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function highlight() {
    dropArea.classList.add("highlight");
  }

  function unhighlight() {
    dropArea.classList.remove("highlight");
  }

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files && files.length) {
      handleFiles({ target: { files } });
    }
  }

  function handleFiles(e) {
    const files = e.target.files;

    if (files && files.length) {
      const file = files[0];

      if (!file.type.match("image.*")) {
        alert("Please select an image file.");
        return;
      }

      const reader = new FileReader();

      reader.onload = function (e) {
        const imageData = e.target.result;
        previewImage.src = imageData;
        previewContainer.style.display = "block";
        dropArea.style.display = "none"; // Hide drop area when image is loaded

        // Save the uploaded image to storage
        saveUploadedImage(imageData);
      };

      reader.readAsDataURL(file);
    }
  }

  function removeImage() {
    previewImage.src = "";
    previewContainer.style.display = "none";
    dropArea.style.display = "block"; // Show drop area when image is removed
    fileInput.value = ""; // Clear the file input

    // Remove user profile image from storage
    chrome.storage.local.remove("userProfileImage", () => {
      // Update Try On button state after removing image
      updateTryOnButtonState();
    });
  }

  // Save the uploaded profile image to storage
  function saveUploadedImage(imageData) {
    chrome.storage.local.set({ userProfileImage: imageData }, () => {
      // Update Try On button state after saving image
      updateTryOnButtonState();
    });
  }

  function loadWardrobeItems() {
    chrome.storage.local.get({ wardrobeImages: [] }, (result) => {
      displayWardrobeItems(result.wardrobeImages);
    });
  }

  // Load user profile image on startup
  function loadUserProfileImage() {
    chrome.storage.local.get("userProfileImage", (result) => {
      if (result.userProfileImage) {
        previewImage.src = result.userProfileImage;
        previewContainer.style.display = "block";
        dropArea.style.display = "none";
      }
    });
  }

  // Call to load user profile image
  loadUserProfileImage();

  function showEmptyState() {
    // Show empty state
    wardrobeContainer.innerHTML = "";
    const emptyWardrobe = document.createElement("div");
    emptyWardrobe.className = "empty-wardrobe";
    emptyWardrobe.textContent = "No processed images yet";
    wardrobeContainer.appendChild(emptyWardrobe);
  }

  function displayWardrobeItems(wardrobeImages) {
    // Clear the wardrobe container
    wardrobeContainer.innerHTML = "";

    if (wardrobeImages.length === 0) {
      showEmptyState();
      // Update the Try On button state
      updateTryOnButtonState();
      return;
    }

    // Sort wardrobe items by timestamp, newest first
    const sortedImages = [...wardrobeImages].sort(
      (a, b) => b.timestamp - a.timestamp
    );

    // Display each wardrobe item
    sortedImages.forEach((item) => {
      createWardrobeItem(item.id, item);
    });

    // Update the Try On button state
    updateTryOnButtonState();
  }

  // Create a wardrobe item using the template
  function createWardrobeItem(id, itemData) {
    // Clone the template
    const templateContent = itemTemplate.content.cloneNode(true);
    const wardrobeItem = templateContent.querySelector(".wardrobe-item");

    // Set item ID and image - use original image for display
    wardrobeItem.id = id;
    const img = wardrobeItem.querySelector("img");

    // Use the original image if available, or the processed image as fallback
    img.src = itemData.originalData || itemData.data || itemData;

    // Store the processed image data as a data attribute for later use
    if (itemData.processedData) {
      wardrobeItem.dataset.processedImage = itemData.processedData;
    }

    // Add delete button event listener
    const deleteBtn = wardrobeItem.querySelector(".delete-btn");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteWardrobeItem(id);
    });

    // Add item to container
    wardrobeContainer.appendChild(wardrobeItem);

    return wardrobeItem;
  }

  // Add a loading item to the wardrobe
  function addLoadingItem(imageUrl) {
    // Remove empty state if present
    const emptyState = wardrobeContainer.querySelector(".empty-wardrobe");
    if (emptyState) {
      emptyState.remove();
    }

    // Generate a temporary ID
    const id = "loading-" + Date.now();

    // Create a new item
    const loadingItem = createWardrobeItem(id, {
      // Use the same image URL for both original and loading display
      originalData: imageUrl,
      data: imageUrl,
    });

    // Add loading state
    loadingItem.classList.add("is-loading");

    // Disable Try On button while loading
    tryOnBtn.disabled = true;

    // Check if overlay exists, if not create it
    let overlay = loadingItem.querySelector(".loading-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "loading-overlay";
      loadingItem.appendChild(overlay);
    }
    overlay.style.display = "flex";

    // Check if loading text exists, if not create it
    let loadingText = overlay.querySelector(".loading-text");
    if (!loadingText) {
      loadingText = document.createElement("div");
      loadingText.className = "loading-text";
      overlay.appendChild(loadingText);
    }

    return loadingItem;
  }

  // Function to delete a wardrobe item
  function deleteWardrobeItem(itemId) {
    // Get existing wardrobe images from storage
    chrome.storage.local.get({ wardrobeImages: [] }, (result) => {
      let wardrobeImages = result.wardrobeImages;

      // Filter out the item to be deleted
      wardrobeImages = wardrobeImages.filter((item) => item.id !== itemId);

      // Save updated wardrobe back to storage
      chrome.storage.local.set({ wardrobeImages: wardrobeImages }, () => {
        // Display the updated wardrobe
        displayWardrobeItems(wardrobeImages);

        // Update Try On button state
        updateTryOnButtonState();
      });
    });
  }

  tryOnBtn.addEventListener("click", () => {
    // Get API key and wardrobe images
    chrome.storage.local.get(
      { apiKey: "", wardrobeImages: [], userProfileImage: null },
      async (result) => {
        if (
          !result.apiKey ||
          result.wardrobeImages.length === 0 ||
          !result.userProfileImage
        ) {
          return;
        }

        // Get the first wardrobe item
        const wardrobeItem = result.wardrobeImages[0];

        // Use the processed image for Try On (with white square)
        const processedImageData =
          wardrobeItem.processedData || wardrobeItem.data;

        // Use the template to create the try-on result container
        const tryOnTemplate = document.getElementById("try-on-result-template");
        const tryOnResultContainer = tryOnTemplate.content
          .cloneNode(true)
          .querySelector(".try-on-result");

        // Set the processed image as the initial preview
        const resultImage = tryOnResultContainer.querySelector(".result-image");
        // resultImage.src = processedImageData;

        // Create a status element
        const statusElement = document.createElement("div");
        statusElement.id = "try-on-status";
        statusElement.className = "loading-text";
        statusElement.textContent = "Generating your image...";

        // Create loading spinner
        const spinner = document.createElement("div");
        spinner.className = "spinner";

        // Create action button (cancels during generation, closes when complete)
        const actionBtn = document.createElement("button");
        actionBtn.className = "btn";
        actionBtn.textContent = "Cancel";

        // Add elements to the container
        const tryOnContent =
          tryOnResultContainer.querySelector(".try-on-content");

        // Find the close button and remove it
        const closeButton = tryOnResultContainer.querySelector(".close-btn");
        if (closeButton) {
          closeButton.remove();
        }

        // Add our elements to the content area - order matters for z-index and layout
        tryOnContent.appendChild(spinner); // Add the spinner directly to try-on-content
        tryOnContent.insertBefore(statusElement, tryOnContent.firstChild);
        tryOnContent.appendChild(actionBtn);

        // Add container to the document
        document.body.appendChild(tryOnResultContainer);

        // Make sure spinner is visible initially
        spinner.style.display = "block";

        // Handle generation
        let isGenerating = true;
        let isCancelled = false;
        let currentTaskId = null;
        let currentBgRequestId = null;
        const clientRequestId = Date.now().toString() + "-client";

        // Set up the action button handler
        actionBtn.addEventListener("click", () => {
          if (isGenerating) {
            // We're still generating - cancel the generation
            isCancelled = true;

            // Send cancel request to background script
            chrome.runtime.sendMessage({
              action: "cancelGeneration",
              clientRequestId: clientRequestId,
              taskId: currentTaskId,
              requestId: currentBgRequestId,
            });

            statusElement.textContent = "Generation cancelled";
            spinner.style.display = "none"; // Hide spinner on cancel
          }

          // In either case, close the view
          document.body.removeChild(tryOnResultContainer);
        });

        try {
          // Start the generation and get response with taskId and requestId
          const response = await startGeneration(
            result.userProfileImage,
            processedImageData,
            result.apiKey,
            clientRequestId
          );
          currentTaskId = response.taskId;
          currentBgRequestId = response.requestId;

          // Poll for completion if not cancelled by the user clicking the button
          if (!isCancelled) {
            try {
              if (response.cancelled) {
                // Already cancelled, nothing more to do
                spinner.style.display = "none";
                return;
              }

              // Only proceed with polling if we have a valid taskId
              if (currentTaskId) {
                const imageUrl = await pollForCompletion(
                  currentTaskId,
                  result.apiKey
                );

                // Update image 
                resultImage.src = imageUrl;
                resultImage.style.display = "block";
                statusElement.textContent = "Image generated successfully!";

                // Hide spinner and update button
                spinner.style.display = "none";
                actionBtn.textContent = "Close";
                isGenerating = false;

                // Save the generated video
                saveGeneratedVideo(processedImageData, imageUrl);
              }
            } catch (error) {
              if (!isCancelled) {
                statusElement.textContent = `Error: ${error.message}`;
                spinner.style.display = "none";
                actionBtn.textContent = "Close";
                isGenerating = false;
              }
            }
          } else {
            // Handle immediate cancellation
            spinner.style.display = "none";
          }
        } catch (error) {
          if (!isCancelled) {
            statusElement.textContent = `Error: ${error.message}`;
            spinner.style.display = "none";
            actionBtn.textContent = "Close";
            isGenerating = false;
          }
        }
      }
    );
  });

  // Function to start video generation
  async function startGeneration(profileImage, imageUrl, apiKey, clientRequestId) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "startGeneration", profileImage, imageUrl, apiKey, clientRequestId },
        (response) => {
          if (response.success) {
            resolve({
              taskId: response.taskId,
              requestId: response.requestId,
            });
          } else {
            if (response.aborted) {
              // This was a cancellation, resolve with cancelled: true and any requestId background sent
              resolve({ cancelled: true, requestId: response.requestId });
            } else {
              reject(new Error(response.error));
            }
          }
        }
      );
    });
  }

  // Function to poll for completion
  async function pollForCompletion(taskId, apiKey) {
    // Poll with a 2-second interval
    const pollInterval = 2000;

    while (true) {
      try {
        const result = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: "pollForCompletion", taskId, apiKey },
            (response) => {
              if (response.success) {
                resolve(response.imageUrl);
              } else if (response.aborted) {
                reject(new Error("aborted"));
              } else if (response.error === "still_processing") {
                reject(new Error("still_processing"));
              } else {
                reject(new Error(response.error));
              }
            }
          );
        });

        // If we get here, the video is ready
        return result;
      } catch (error) {
        if (error.message === "still_processing") {
          // Wait and try again
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        } else if (error.message === "aborted") {
          throw new Error("Cancelled");
        } else {
          // Real error, propagate it
          throw error;
        }
      }
    }
  }

  // Function to save generated video
  function saveGeneratedVideo(imageUrl, videoUrl) {
    chrome.storage.local.get({ generatedVideos: [] }, (result) => {
      const videos = result.generatedVideos || [];
      videos.push({
        imageUrl,
        videoUrl,
        timestamp: Date.now(),
      });
      chrome.storage.local.set({ generatedVideos: videos });
    });
  }
})();
