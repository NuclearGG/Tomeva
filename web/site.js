(function () {
  "use strict";

  const applications = {
    control: {
      number: "01",
      audience: "For the setup lead",
      kicker: "The first book off the shelf",
      title: "Control Center",
      description: "Turns an empty Firebase project into an institution-ready Tomeva system, then delivers each configured application.",
      functions: [
        "Configure institution-owned Firebase",
        "Generate security rules and indexes",
        "Download checksum-verified applications",
        "Create encrypted recovery kits"
      ],
      note: "No Tomeva account required.",
      accent: "#4b4fc9"
    },
    admin: {
      number: "02",
      audience: "For authorised staff",
      kicker: "The governance desk",
      title: "Admin",
      description: "Gives designated staff a connected view of access, kiosks, circulation information, and software rollout decisions.",
      functions: [
        "Pre-register admission numbers from CSV or JSON",
        "Authorize student and staff access",
        "Provision and revoke Librarian kiosks",
        "Approve, pause, and schedule application updates"
      ],
      note: "Online access uses your institution's sign-in policy.",
      accent: "#b63e65"
    },
    librarian: {
      number: "03",
      audience: "For the library desk",
      kicker: "The working ledger",
      title: "Librarian",
      description: "Keeps the circulation desk responsive with a local database while protected synchronization carries approved changes to the wider system.",
      functions: [
        "Issue, return, renew, and search books offline",
        "Manage students, fines, and damaged items",
        "Review requests and desk notifications",
        "Back up the local SQLite circulation database"
      ],
      note: "Daily circulation continues during internet outages.",
      accent: "#167f78"
    },
    student: {
      number: "04",
      audience: "For students and teachers",
      kicker: "The public catalog",
      title: "Student Portal",
      description: "Makes the library searchable from any modern browser while keeping private circulation controls out of the public experience.",
      functions: [
        "Browse the catalog and current availability",
        "Search by title, author, subject, or identifier",
        "Submit and track book requests",
        "Read library messages and manage a profile"
      ],
      note: "Deploy the static portal on your institution's HTTPS host.",
      accent: "#d99224"
    }
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const menuToggle = document.querySelector(".menu-toggle");
  const navLinks = document.querySelector(".nav-links");
  const themeToggle = document.querySelector(".theme-toggle");
  const bookChoices = Array.from(document.querySelectorAll(".book-choice"));
  const detail = document.querySelector(".app-detail");

  function closeMenu() {
    if (!menuToggle || !navLinks) return;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
    navLinks.classList.remove("is-open");
  }

  menuToggle?.addEventListener("click", function () {
    const open = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!open));
    menuToggle.setAttribute("aria-label", open ? "Open navigation" : "Close navigation");
    navLinks.classList.toggle("is-open", !open);
  });

  navLinks?.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenu();
  });

  function systemIsDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function currentTheme() {
    return root.dataset.theme || (systemIsDark() ? "dark" : "light");
  }

  function updateThemeLabel() {
    const label = themeToggle?.querySelector("span");
    if (label) label.textContent = currentTheme() === "dark" ? "Day" : "Night";
  }

  themeToggle?.addEventListener("click", function () {
    root.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
    updateThemeLabel();
  });
  updateThemeLabel();

  function renderApplication(key, focusDetail) {
    const app = applications[key];
    if (!app || !detail) return;

    bookChoices.forEach(function (choice) {
      const active = choice.dataset.app === key;
      choice.classList.toggle("is-active", active);
      choice.setAttribute("aria-selected", String(active));
      choice.tabIndex = active ? 0 : -1;
    });

    detail.classList.remove("is-changing");
    void detail.offsetWidth;
    detail.style.setProperty("--detail-accent", app.accent);
    document.getElementById("detail-number").textContent = app.number;
    document.getElementById("detail-audience").textContent = app.audience;
    document.getElementById("detail-kicker").textContent = app.kicker;
    document.getElementById("detail-title").textContent = app.title;
    document.getElementById("detail-description").textContent = app.description;
    document.getElementById("detail-note").textContent = app.note;
    document.getElementById("detail-functions").innerHTML = app.functions.map(function (item, index) {
      return "<li><span>" + String(index + 1).padStart(2, "0") + "</span>" + item + "</li>";
    }).join("");
    detail.classList.add("is-changing");

    if (focusDetail && window.innerWidth < 781) {
      detail.focus({ preventScroll: true });
      detail.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
    }
  }

  bookChoices.forEach(function (choice, index) {
    choice.addEventListener("click", function () {
      renderApplication(choice.dataset.app, true);
    });

    choice.addEventListener("keydown", function (event) {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index - 1 + bookChoices.length) % bookChoices.length;
      if (event.key === "ArrowRight") next = (index + 1) % bookChoices.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = bookChoices.length - 1;
      bookChoices[next].focus();
      renderApplication(bookChoices[next].dataset.app, false);
    });

    choice.addEventListener("pointermove", function (event) {
      if (reduceMotion.matches || event.pointerType === "touch") return;
      const bounds = choice.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - .5;
      const y = (event.clientY - bounds.top) / bounds.height - .5;
      choice.style.setProperty("--ry", (x * 9).toFixed(2) + "deg");
      choice.style.setProperty("--rx", (-y * 7).toFixed(2) + "deg");
    });

    choice.addEventListener("pointerleave", function () {
      choice.style.setProperty("--ry", "0deg");
      choice.style.setProperty("--rx", "0deg");
    });
  });

  const revealItems = document.querySelectorAll(".reveal");
  if (reduceMotion.matches || !("IntersectionObserver" in window)) {
    revealItems.forEach(function (item) { item.classList.add("is-visible"); });
  } else {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: .12 });
    revealItems.forEach(function (item) { observer.observe(item); });
  }

  function setReleaseAsset(asset, key) {
    if (!asset) return;
    document.querySelectorAll(".js-dl-" + key).forEach(function (link) { link.href = asset.browser_download_url; });
    document.querySelectorAll(".js-file-" + key).forEach(function (node) { node.textContent = asset.name; });
    document.querySelectorAll(".js-size-" + key).forEach(function (node) { node.textContent = Math.round(asset.size / 1048576) + " MB"; });
  }

  fetch("https://api.github.com/repos/NuclearGG/Tomeva/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then(function (response) {
      if (!response.ok) throw new Error("Release lookup failed");
      return response.json();
    })
    .then(function (release) {
      const assets = release.assets || [];
      const version = String(release.tag_name || "").replace(/^v/, "");
      document.querySelectorAll(".js-ver").forEach(function (node) { if (version) node.textContent = version; });
      setReleaseAsset(assets.find(function (asset) { return /control-center.*-win-x64\.exe$/i.test(asset.name); }), "new");
      setReleaseAsset(assets.find(function (asset) { return /control-center.*-win7-x64\.exe$/i.test(asset.name); }), "old");
    })
    .catch(function () {
      document.querySelectorAll(".js-ver").forEach(function (node) { node.textContent = "View release"; });
    });

  const footerYear = document.getElementById("footer-year");
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
})();
