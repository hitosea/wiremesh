package collector

import "testing"

func TestParseXrayOnlineUsers(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []string
	}{
		{
			name:  "real xray format",
			input: `{"users":["user>>>uuid-aaa>>>online","user>>>uuid-bbb>>>online"]}`,
			want:  []string{"uuid-aaa", "uuid-bbb"},
		},
		{
			name:  "no users online",
			input: `{"users":[]}`,
			want:  nil,
		},
		{
			name:  "empty users object",
			input: `{}`,
			want:  nil,
		},
		{
			name:  "invalid json",
			input: `not json`,
			want:  nil,
		},
		{
			name:  "empty string",
			input: "",
			want:  nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseXrayOnlineUsers(tt.input)
			if len(got) != len(tt.want) {
				t.Errorf("parseXrayOnlineUsers(%q) = %v, want %v", tt.input, got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("parseXrayOnlineUsers(%q)[%d] = %q, want %q", tt.input, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestParseXrayTransfers(t *testing.T) {
	input := `{"stat":[
		{"name":"user>>>aaa>>>traffic>>>uplink","value":1000},
		{"name":"user>>>aaa>>>traffic>>>downlink","value":5000},
		{"name":"user>>>bbb>>>traffic>>>uplink","value":200},
		{"name":"user>>>bbb>>>traffic>>>downlink","value":300}
	]}`
	got := parseXrayTransfers(input)
	if len(got) != 2 {
		t.Fatalf("expected 2 users, got %d", len(got))
	}
	byUuid := map[string][2]int64{}
	for u, v := range got {
		byUuid[u] = [2]int64{v.uplink, v.downlink}
	}
	if byUuid["aaa"] != [2]int64{1000, 5000} {
		t.Errorf("aaa got %v", byUuid["aaa"])
	}
	if byUuid["bbb"] != [2]int64{200, 300} {
		t.Errorf("bbb got %v", byUuid["bbb"])
	}
}

func TestParseXrayOnlineIpList(t *testing.T) {
	input := `{"ips":{"1.2.3.4":1776727876,"5.6.7.8":1776727877},"name":"user>>>xxx>>>online"}`
	got := parseXrayOnlineIpList(input)
	if len(got) != 2 {
		t.Fatalf("expected 2 ips, got %d", len(got))
	}
	m := map[string]int64{}
	for _, ip := range got {
		m[ip.Ip] = ip.LastSeen
	}
	if m["1.2.3.4"] != 1776727876 || m["5.6.7.8"] != 1776727877 {
		t.Errorf("parsed wrong: %v", got)
	}
}

func TestParseXrayOnlineIpListEmpty(t *testing.T) {
	if got := parseXrayOnlineIpList(`{"name":"user>>>x>>>online"}`); len(got) != 0 {
		t.Errorf("expected empty, got %v", got)
	}
}

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		input int64
		want  string
	}{
		{0, "0 B"},
		{500, "500 B"},
		{1024, "1.0 KiB"},
		{1048576, "1.0 MiB"},
		{1073741824, "1.0 GiB"},
		{5368709120, "5.0 GiB"},
	}
	for _, tt := range tests {
		got := FormatBytes(tt.input)
		if got != tt.want {
			t.Errorf("FormatBytes(%d) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
