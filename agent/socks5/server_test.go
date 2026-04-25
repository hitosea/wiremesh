package socks5

import (
	"testing"
)

func resetSocks5Stats(t *testing.T) {
	t.Helper()
	statsMu.Lock()
	stats = map[int]*lineStats{}
	statsMu.Unlock()
}

func TestCollectTransfersDeltas(t *testing.T) {
	resetSocks5Stats(t)

	s1 := getOrCreateStats(1)
	s1.upload.Add(1000)
	s1.download.Add(2000)

	got := CollectTransfers()
	if len(got) != 1 {
		t.Fatalf("first call: expected 1 report, got %d", len(got))
	}
	if got[0].LineID != 1 || got[0].UploadBytes != 1000 || got[0].DownloadBytes != 2000 {
		t.Errorf("first call: unexpected report %+v", got[0])
	}

	// No new traffic — should be omitted.
	if got := CollectTransfers(); len(got) != 0 {
		t.Errorf("idle call: expected no reports, got %v", got)
	}

	// More traffic on line 1, plus new line 2.
	s1.upload.Add(500)
	s2 := getOrCreateStats(2)
	s2.download.Add(7000)

	got = CollectTransfers()
	if len(got) != 2 {
		t.Fatalf("second call: expected 2 reports, got %d", len(got))
	}
	byLine := map[int]struct{ up, down int64 }{}
	for _, r := range got {
		byLine[r.LineID] = struct{ up, down int64 }{r.UploadBytes, r.DownloadBytes}
	}
	if byLine[1] != (struct{ up, down int64 }{500, 0}) {
		t.Errorf("line 1 delta: got %+v, want {500 0}", byLine[1])
	}
	if byLine[2] != (struct{ up, down int64 }{0, 7000}) {
		t.Errorf("line 2 delta: got %+v, want {0 7000}", byLine[2])
	}
}

func TestCollectTransfersEmpty(t *testing.T) {
	resetSocks5Stats(t)
	if got := CollectTransfers(); got != nil {
		t.Errorf("expected nil with no stats, got %v", got)
	}
}
