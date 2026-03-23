import "./style.css";

// Scroll-triggered reveal animations
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
);

for (const el of document.querySelectorAll("[data-reveal]")) {
  observer.observe(el);
}
