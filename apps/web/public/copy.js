// Copies the command next to a [data-copy] button. Without JavaScript the button stays hidden.
for (const button of document.querySelectorAll("[data-copy]")) {
	button.hidden = false;
	button.addEventListener("click", async () => {
		await navigator.clipboard.writeText(button.dataset.copy);
		const label = button.textContent;
		button.textContent = button.dataset.copied;
		setTimeout(() => {
			button.textContent = label;
		}, 1500);
	});
}
