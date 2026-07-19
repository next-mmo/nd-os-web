import { mount } from "svelte";
import App from "./App.svelte";
import "./global.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Unable to find the #app mount element");
}

mount(App, { target });
