(() => {
  // My Little Journey — Supabase reflection editor
  // IMPORTANT: replace the placeholder below with your Supabase Publishable key.
  const SUPABASE_URL = "https://gmghzvsllkmnjtvwixv.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_v7XrHNr943DD81ki3rX9KA_4iYuRr6o";
  const OWNER_UID = "b21028dd-b5b9-448c-affa-dd099e46a769";
  const FIELD_INFO = [
    ["happened", "What happened this week?", "Describe the key events, classes, or experiences..."],
    ["learned", "What did I learn?", "What ideas, skills, or insights did I gain?"],
    ["challenges", "Challenges and questions", "What was difficult? What questions remain?"],
    ["next_steps", "Next steps", "What will I do next week?"]
  ];

  const pages = [...document.querySelectorAll("[data-page]")];
  const navLinks = [...document.querySelectorAll("[data-page-link]")];
  const editors = new Map();
  const saveTimers = new Map();
  const savedValues = new Map();
  let client = null;
  let currentUser = null;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function showPage() {
    const wanted = location.hash.slice(1) || "home";
    const pageName = pages.some(p => p.dataset.page === wanted) ? wanted : "home";
    pages.forEach(p => p.classList.toggle("active", p.dataset.page === pageName));
    const activeNav = pageName.startsWith("week") ? "reflections" : pageName;
    navLinks.forEach(a => a.classList.toggle("active", a.dataset.pageLink === activeNav));
    window.scrollTo(0, 0);
  }

  function setStatus(week, message, state = "") {
    const editor = editors.get(week);
    if (!editor) return;
    editor.status.textContent = message;
    editor.status.dataset.state = state;
  }

  function makeAccountPanel() {
    const host = document.querySelector('[data-page="reflections"]');
    if (!host || document.getElementById("account-panel")) return;

    const panel = make("section", "account-panel");
    panel.id = "account-panel";
    panel.append(make("h2", "", "Reflection editor"));
    const description = make("p", "account-description",
      "Saved reflections are public to read. Sign in with the owner account to edit.");
    const form = make("form", "account-form");
    const email = make("input");
    email.type = "email";
    email.autocomplete = "username";
    email.placeholder = "Your email";
    email.required = true;
    const password = make("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.placeholder = "Your password";
    password.required = true;
    const signIn = make("button", "reflection-button", "Sign in");
    signIn.type = "submit";
    form.append(email, password, signIn);
    const signOut = make("button", "reflection-button secondary", "Sign out");
    signOut.type = "button";
    signOut.hidden = true;
    const message = make("p", "account-message",
      "Use the email and password you created in Supabase Authentication → Users.");
    message.setAttribute("role", "status");
    panel.append(description, form, signOut, message);
    host.insertBefore(panel, host.querySelector(".week-list"));

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!client) return;
      signIn.disabled = true;
      message.textContent = "Signing in…";
      const { error } = await client.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value
      });
      signIn.disabled = false;
      if (error) message.textContent = "Sign-in failed: " + error.message;
      else { password.value = ""; message.textContent = "Signed in."; }
    });

    signOut.addEventListener("click", async () => {
      const { error } = await client.auth.signOut();
      message.textContent = error ? "Sign-out failed: " + error.message : "Signed out.";
    });
    panel._parts = { description, form, signOut, message };
  }

  function updateAccountPanel() {
    const panel = document.getElementById("account-panel");
    if (!panel) return;
    const { description, form, signOut, message } = panel._parts;
    const isOwner = !!currentUser && currentUser.id === OWNER_UID;
    form.hidden = isOwner;
    signOut.hidden = !currentUser;
    description.textContent = isOwner
      ? "You are signed in as the editor. Everyone can read saved reflections."
      : "Saved reflections are public to read. Sign in with the owner account to edit.";
    if (currentUser && !isOwner) {
      message.textContent = "This account is not authorised to edit reflections.";
    } else if (isOwner) {
      message.textContent = "Signed in. You can now edit and save weekly reflections.";
    }
    renderEditors();
  }

  function makeEditor(week, page) {
    const host = make("section", "reflection-editor");
    host.dataset.week = String(week);
    host.append(
      make("h2", "", "Week " + week + " reflection"),
      make("p", "editor-intro", "A little space to record what you learned this week.")
    );
    const fields = make("div", "reflection-fields");
    const inputs = {};

    FIELD_INFO.forEach(([key, label, placeholder]) => {
      const wrapper = make("label", "reflection-field");
      wrapper.append(make("span", "", label));
      const input = make("textarea");
      input.rows = 4;
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label);
      input.dataset.field = key;
      wrapper.append(input);
      fields.append(wrapper);
      inputs[key] = input;

      input.addEventListener("input", () => {
        if (!currentUser || currentUser.id !== OWNER_UID) return;
        setStatus(week, "Unsaved changes…", "pending");
        clearTimeout(saveTimers.get(week));
        saveTimers.set(week, setTimeout(() => saveWeek(week), 1000));
      });
    });

    const controls = make("div", "editor-controls");
    const save = make("button", "reflection-button", "Save reflection");
    save.type = "button";
    const status = make("p", "save-status", "Loading reflection…");
    status.setAttribute("role", "status");
    save.addEventListener("click", () => saveWeek(week));
    controls.append(save, status);
    host.append(fields, controls);
    page.append(host);
    editors.set(week, { host, inputs, save, status });
  }

  function prepareEditors() {
    makeAccountPanel();
    for (let week = 1; week <= 6; week++) {
      const page = document.querySelector('[data-page="week' + week + '"]');
      if (!page || editors.has(week)) continue;
      // Remove the sample reflection from the original Week 1 page so database
      // content becomes the single source of truth.
      if (week === 1) {
        page.querySelector(".week-detail-top")?.remove();
        page.querySelector(".week-subtitle")?.remove();
        page.querySelector(".reflection-steps")?.remove();
        page.querySelector("blockquote")?.remove();
      }
      page.querySelector(".empty-note")?.remove();
      makeEditor(week, page);
    }
    renderEditors();
  }

  function renderEditors() {
    for (const [week, editor] of editors) {
      const owner = !!currentUser && currentUser.id === OWNER_UID;
      Object.values(editor.inputs).forEach(input => {
        input.readOnly = !owner;
        input.setAttribute("aria-readonly", String(!owner));
      });
      editor.save.hidden = !owner;
      editor.host.classList.toggle("is-readonly", !owner);
      if (currentUser && !owner) {
        editor.status.textContent = "Read-only: this account cannot edit reflections.";
      }
    }
  }

  function applyRow(week, row) {
    const editor = editors.get(week);
    if (!editor) return;
    const values = {};
    FIELD_INFO.forEach(([key]) => {
      values[key] = row?.[key] || "";
      editor.inputs[key].value = values[key];
    });
    savedValues.set(week, values);
    setStatus(week, row
      ? "Last saved: " + new Date(row.updated_at).toLocaleString()
      : "No reflection saved yet.", "");
  }

  async function loadWeek(week) {
    if (!client) return;
    setStatus(week, "Loading reflection…");
    const { data, error } = await client
      .from("weekly_reflections")
      .select("week_number,happened,learned,challenges,next_steps,updated_at")
      .eq("week_number", week)
      .maybeSingle();

    if (error) {
      setStatus(week, "Could not load reflection: " + error.message, "error");
      return;
    }
    applyRow(week, data);
  }

  async function saveWeek(week) {
    if (!client || !currentUser || currentUser.id !== OWNER_UID) {
      setStatus(week, "Sign in with the authorised owner account before saving.", "error");
      return;
    }
    const editor = editors.get(week);
    if (!editor) return;
    clearTimeout(saveTimers.get(week));

    const values = {};
    FIELD_INFO.forEach(([key]) => values[key] = editor.inputs[key].value);
    const previous = savedValues.get(week);
    if (previous && FIELD_INFO.every(([key]) => previous[key] === values[key])) {
      setStatus(week, "Everything is saved.", "saved");
      return;
    }

    editor.save.disabled = true;
    setStatus(week, "Saving…", "pending");
    const { data, error } = await client
      .from("weekly_reflections")
      .upsert({
        user_id: currentUser.id,
        week_number: week,
        ...values
      }, { onConflict: "user_id,week_number" })
      .select("updated_at")
      .single();

    editor.save.disabled = false;
    if (error) {
      setStatus(week, "Save failed: " + error.message + ". Your text remains on this page; try again.", "error");
      return;
    }
    savedValues.set(week, values);
    setStatus(week, "Saved successfully at " + new Date(data.updated_at).toLocaleString(), "saved");
  }

  async function loadAllWeeks() {
    for (let week = 1; week <= 6; week++) await loadWeek(week);
  }

  function start() {
    showPage();
    prepareEditors();

    if (!window.supabase?.createClient) {
      document.querySelectorAll(".save-status").forEach(n => n.textContent = "Supabase library did not load. Refresh the page.");
      return;
    }
    if (SUPABASE_PUBLISHABLE_KEY === "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE") {
      document.querySelectorAll(".save-status").forEach(n => n.textContent = "Setup needed: add your Supabase Publishable key in script.js.");
      const message = document.querySelector(".account-message");
      if (message) message.textContent = "Open script.js and replace PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE with your Publishable key.";
      return;
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      updateAccountPanel();
      loadAllWeeks();
    });
    client.auth.getSession().then(({ data }) => {
      currentUser = data.session?.user || null;
      updateAccountPanel();
      loadAllWeeks();
    });
  }

  window.addEventListener("hashchange", showPage);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
