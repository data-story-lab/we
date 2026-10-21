
(() => {
  const pages = [...document.querySelectorAll("[data-page]")];
  const links = [...document.querySelectorAll("[data-page-link]")];

  function showPage() {
    const requested = location.hash.slice(1) || "home";
    const pageExists = pages.some(
      page => page.dataset.page === requested
    );
    const pageName = pageExists ? requested : "home";

    pages.forEach(page => {
      page.classList.toggle(
        "active",
        page.dataset.page === pageName
      );
    });

    const activeNav = pageName.startsWith("week")
      ? "reflections"
      : pageName;

    links.forEach(link => {
      link.classList.toggle(
        "active",
        link.dataset.pageLink === activeNav
      );
    });

    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", showPage);
  showPage();
})();
