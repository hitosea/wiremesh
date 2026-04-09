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
