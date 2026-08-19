// Reframed — shared site behaviour
// Nav logo: split into letters, flip one at a time with a glitch glyph mid-spin.
(function () {
  const logo = document.querySelector(".nav-logo");
  if (!logo) return;

  const text = logo.textContent.trim();
  logo.textContent = "";
  const letters = [...text].map((ch) => {
    const s = document.createElement("span");
    s.className = "lg";
    s.textContent = ch;
    logo.appendChild(s);
    return s;
  });

  const GLYPHS = "#%/\\*+=?<>[]{}~:;";

  function glitch(el) {
    if (el.classList.contains("glitch")) return;
    const orig = el.textContent;
    el.classList.add("glitch");
    // Swap while the letter is edge-on (25% of the 560ms flip), restore mid-spin.
    setTimeout(() => { el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; }, 140);
    setTimeout(() => { el.textContent = orig; }, 320);
    setTimeout(() => { el.classList.remove("glitch"); }, 580);
  }

  function loop() {
    glitch(letters[Math.floor(Math.random() * letters.length)]);
    setTimeout(loop, 1800 + Math.random() * 4200);
  }

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Opening cascade left to right, then settle into random single flips.
    letters.forEach((el, i) => setTimeout(() => glitch(el), 400 + i * 90));
    setTimeout(loop, 2800);
  }
})();
