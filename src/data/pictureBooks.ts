export type PictureBookSentence = { id: string; text: string; position: number; required: boolean };
export type PictureBookOfficialAudio = {
  url: string;
  label?: string;
  credit?: string;
  sourceUrl?: string;
};
export type PictureBookPage = {
  id: string;
  position: number;
  imageUrl: string;
  kind: "cover" | "story";
  sentences: PictureBookSentence[];
  officialAudio?: PictureBookOfficialAudio;
};
export type PictureBook = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  language: string;
  level: string;
  tags: string[];
  isbn: string;
  coverImageUrl: string;
  creators: { role: "writer" | "illustrator" | "designer"; name: string }[];
  source: { name: string; url: string };
  license: { code: string; name: string; url: string; attribution: string };
  officialAudio?: PictureBookOfficialAudio;
  pages: PictureBookPage[];
};

// The open-source repository intentionally does not bundle third-party books,
// page images, narration, textbook content, or other copyrighted learning assets.
// Families can import content they are authorized to use through the application.
export const pictureBooks: PictureBook[] = [];

export function findPictureBook(slug: string) {
  return pictureBooks.find((book) => book.slug === slug);
}
