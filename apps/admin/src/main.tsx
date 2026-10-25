import { render } from "preact";

const Hello = () => (
  <main>
    <h1>bugstack</h1>
    <p>Hello from the bugstack admin.</p>
  </main>
);

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element in index.html");
render(<Hello />, root);
