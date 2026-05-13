import { iNat } from "./api.js";

const DEBOUNCE_MS = 200;
const MIN_QUERY_LEN = 2;
const PER_PAGE = 5;

export function attachAutocomplete(input, { endpoint, renderItem }) {
  const wrap = document.createElement("span");
  wrap.className = "ac-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement("ul");
  list.className = "ac-list";
  list.hidden = true;
  wrap.appendChild(list);

  let items = [];
  let activeIndex = -1;
  let selected = null;
  let debounceTimer = 0;
  let reqCounter = 0;

  function close() {
    list.hidden = true;
    list.innerHTML = "";
    items = [];
    activeIndex = -1;
  }

  function setActive(i) {
    const children = list.children;
    if (activeIndex >= 0 && children[activeIndex]) {
      children[activeIndex].classList.remove("active");
    }
    activeIndex = i;
    if (i >= 0 && children[i]) {
      children[i].classList.add("active");
      children[i].scrollIntoView({ block: "nearest" });
    }
  }

  function select(item) {
    selected = item;
    input.value = item.display_name || item.name || input.value;
    close();
    input.dispatchEvent(
      new CustomEvent("autocomplete:select", { detail: { item } }),
    );
  }

  function render(results) {
    list.innerHTML = "";
    items = results;
    if (!results.length) {
      close();
      return;
    }
    results.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = "ac-item";
      renderItem(r, li);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select(r);
      });
      li.addEventListener("mouseenter", () => setActive(i));
      list.appendChild(li);
    });
    list.hidden = false;
    setActive(0);
  }

  async function query(q) {
    const myReq = ++reqCounter;
    try {
      const { results } = await iNat(endpoint, { q, per_page: PER_PAGE });
      if (myReq !== reqCounter) return;
      if (input.value.trim() !== q) return;
      render(results || []);
    } catch {
      if (myReq === reqCounter) close();
    }
  }

  input.addEventListener("input", () => {
    selected = null;
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < MIN_QUERY_LEN) {
      reqCounter++;
      close();
      return;
    }
    debounceTimer = setTimeout(() => query(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((activeIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length)
        setActive((activeIndex - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        select(items[activeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  return {
    getSelected: () => selected,
    clearSelected: () => {
      selected = null;
    },
    setSelected: (item) => {
      selected = item;
      if (item) {
        input.value = item.display_name || item.name || "";
      }
    },
  };
}
