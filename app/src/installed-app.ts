// iOS home screen apps report themselves through navigator.standalone; mark
// the root before the first render so the top bar hides its brand mark (#1200).
export function markInstalledApp(root: HTMLElement = document.documentElement) {
  if ((navigator as Navigator & { standalone?: boolean }).standalone) {
    root.classList.add("installed-app");
  }
}
