async function sendForm(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Request failed.");
  }

  return result;
}

const pickupForm = document.getElementById("pickupForm");

if (pickupForm) {
  pickupForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const message = document.getElementById("pickupMessage");
    const button = pickupForm.querySelector('button[type="submit"]');

    const name = document.getElementById("pickupName");
    const phone = document.getElementById("pickupPhone");
    const address = document.getElementById("pickupAddress");
    const wasteType = document.getElementById("wasteType");
    const pickupDate = document.getElementById("pickupDate");

    if (
      !name ||
      !phone ||
      !address ||
      !wasteType ||
      !pickupDate ||
      !message ||
      !button
    ) {
      console.error("Missing pickup form element:", {
        name: !!name,
        phone: !!phone,
        address: !!address,
        wasteType: !!wasteType,
        pickupDate: !!pickupDate,
        message: !!message,
        button: !!button,
      });

      if (message) {
        message.textContent =
          "Pickup form setup error. Check the missing fields in Console.";
      }
      return;
    }

    const data = {
      name: name.value.trim(),
      phone: phone.value.trim(),
      address: address.value.trim(),
      waste_type: wasteType.value.trim(),
      pickup_date: pickupDate.value,
    };

    const missing = Object.entries(data)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      message.textContent = "Please fill in: " + missing.join(", ");
      return;
    }

    button.disabled = true;
    message.textContent = "Submitting pickup request...";

    try {
      const result = await sendForm("/api/pickups", data);
      message.textContent =
        result.message || "Pickup request submitted successfully!";
      pickupForm.reset();
    } catch (error) {
      console.error("Pickup error:", error);
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
