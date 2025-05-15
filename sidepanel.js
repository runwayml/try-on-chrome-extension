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
      chrome.storage.local.get({ wardrobeImages: [] }, (result) => {
        tryOnBtn.disabled = result.wardrobeImages.length === 0;
      });
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
        // Enable Try On button if there are no items
        tryOnBtn.disabled = true;
      }

      // Show error message
      alert(`Processing failed: ${message.error}`);
    }
  });

  // Remove image button click
  removeImageBtn.addEventListener("click", removeImage);

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
  chrome.storage.local.get({ wardrobeImages: [] }, (result) => {
    tryOnBtn.disabled = result.wardrobeImages.length === 0;
  });

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
    chrome.storage.local.remove("userProfileImage");
  }

  // Save the uploaded profile image to storage
  function saveUploadedImage(imageData) {
    chrome.storage.local.set({ userProfileImage: imageData });
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
      // Enable the Try On button when there are no pictures
      tryOnBtn.disabled = true;
      return;
    }

    // Sort wardrobe items by timestamp, newest first
    const sortedImages = [...wardrobeImages].sort(
      (a, b) => b.timestamp - a.timestamp
    );

    // Display each wardrobe item
    sortedImages.forEach((item) => {
      createWardrobeItem(item.id, item.data);
    });

    // Disable the Try On button when there are pictures
    tryOnBtn.disabled = false;
  }

  // Create a wardrobe item using the template
  function createWardrobeItem(id, imageData) {
    // Clone the template
    const templateContent = itemTemplate.content.cloneNode(true);
    const wardrobeItem = templateContent.querySelector(".wardrobe-item");

    // Set item ID and image
    wardrobeItem.id = id;
    const img = wardrobeItem.querySelector("img");
    img.src = imageData;

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
    const loadingItem = createWardrobeItem(id, imageUrl);

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

    // Start the loading animation
    loadingText.textContent = "Processing image...";
    const updateInterval = setInterval(() => {
      loadingText.textContent = `Processing image...`;
    }, 1000);

    // Store the interval ID to clear it if needed
    loadingItem.dataset.intervalId = updateInterval;

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

        // Enable try on button if all images have been deleted
        if (wardrobeImages.length === 0) {
          tryOnBtn.disabled = true;
        }
      });
    });
  }

  tryOnBtn.addEventListener("click", () => {
    // @todo add API call to Runway
    console.log("Try On button clicked");
  });
})();
