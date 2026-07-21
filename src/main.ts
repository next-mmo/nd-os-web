import { mount } from "svelte";
import App from "./app/App.svelte";
import "./app.css";
import "./styles/desktop.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Unable to find the #app mount element");
}

mount(App, { target });
