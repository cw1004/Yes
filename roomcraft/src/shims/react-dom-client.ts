declare global {
  interface Window {
    ReactDOM: any;
  }
}
export const createRoot = (container: Element) => window.ReactDOM.createRoot(container);
