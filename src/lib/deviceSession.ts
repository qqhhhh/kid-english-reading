const ACTIVE_CHILD_KEY = "kid-reading-active-child-id";
const ACTIVE_LESSON_KEY = "kid-reading-active-lesson-id";
const ACTIVE_PRACTICE_ITEM_KEY = "kid-reading-active-practice-item-id";

export function getDeviceChildId() {
  return window.localStorage.getItem(ACTIVE_CHILD_KEY) || "";
}

export function getDeviceLessonId() {
  return window.localStorage.getItem(ACTIVE_LESSON_KEY) || "";
}

export function getDevicePracticeItemId() {
  return window.localStorage.getItem(ACTIVE_PRACTICE_ITEM_KEY) || "";
}

export function storeDevicePracticeContext(childId: string, lessonId = "", practiceItemId = "") {
  window.localStorage.setItem(ACTIVE_CHILD_KEY, childId);
  if (lessonId) {
    window.localStorage.setItem(ACTIVE_LESSON_KEY, lessonId);
  } else {
    window.localStorage.removeItem(ACTIVE_LESSON_KEY);
  }
  if (practiceItemId) {
    window.localStorage.setItem(ACTIVE_PRACTICE_ITEM_KEY, practiceItemId);
  } else {
    window.localStorage.removeItem(ACTIVE_PRACTICE_ITEM_KEY);
  }
}

export function getUrlPracticeContext() {
  const params = new URLSearchParams(window.location.search);
  return {
    childId: params.get("childId") || "",
    lessonId: params.get("lessonId") || "",
    practiceItemId: params.get("itemId") || ""
  };
}
