const PAPER_SPECS = {
  a4: {
    id: 'a4',
    label: 'A4',
    widthPt: 595.28,
    heightPt: 841.89
  },
  letter: {
    id: 'letter',
    label: 'US Letter',
    widthPt: 612,
    heightPt: 792
  }
};

const DEFAULT_PAPER_ID = 'a4';
const DEFAULT_MARGIN_PT = 14;

export function getPaperSpec(paperId = DEFAULT_PAPER_ID) {
  return PAPER_SPECS[paperId] || PAPER_SPECS[DEFAULT_PAPER_ID];
}

export function getPaperOptions() {
  return Object.values(PAPER_SPECS).map((paper) => ({
    id: paper.id,
    label: paper.label
  }));
}

export function getDefaultPaperId() {
  return DEFAULT_PAPER_ID;
}

export function getPdfLayout(paperId = DEFAULT_PAPER_ID) {
  const paper = getPaperSpec(paperId);

  return {
    ...paper,
    marginPt: DEFAULT_MARGIN_PT,
    contentWidthPt: paper.widthPt - DEFAULT_MARGIN_PT * 2,
    contentHeightPt: paper.heightPt - DEFAULT_MARGIN_PT * 2
  };
}
