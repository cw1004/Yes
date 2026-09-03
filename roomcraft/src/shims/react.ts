// React and ReactDOM arrive as UMD globals from cdnjs; these shims let the
// bundled app keep importing them the normal way.
declare global {
  interface Window {
    React: any;
  }
}
const React = window.React;
export default React;
export const { useState, useEffect, useMemo, useRef, Fragment, createElement } = React;
