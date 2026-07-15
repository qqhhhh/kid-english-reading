(function () {
  try {
    var themes = ["peach", "blue", "ivory", "mint"];
    var chromes = ["classic", "storybook"];
    var themeChrome = { peach: "storybook", blue: "classic", ivory: "classic", mint: "classic" };
    var storedTheme = localStorage.getItem("kid-reading-design-theme");
    var theme = themes.indexOf(storedTheme) >= 0 ? storedTheme : "peach";
    var storedChrome = localStorage.getItem("kid-reading-design-chrome");
    var chrome = chromes.indexOf(storedChrome) >= 0 ? storedChrome : themeChrome[theme] || "storybook";
    document.documentElement.dataset.designTheme = theme;
    document.documentElement.dataset.designChrome = chrome;
  } catch (error) {
    document.documentElement.dataset.designTheme = "peach";
    document.documentElement.dataset.designChrome = "storybook";
  }
})();
