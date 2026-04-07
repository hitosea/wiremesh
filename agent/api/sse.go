package api

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

type SSEEvent struct {
	Event string
	Data  string
}

const (
	sseReconnectDelay    = 5 * time.Second
	sseMaxReconnectDelay = 60 * time.Second
)

type SSEClient struct {
	client  *Client
	ctx     context.Context
	cancel  context.CancelFunc
	eventCh chan SSEEvent
}

func NewSSEClient(client *Client) *SSEClient {
	ctx, cancel := context.WithCancel(context.Background())
	return &SSEClient{
		client:  client,
		ctx:     ctx,
		cancel:  cancel,
		eventCh: make(chan SSEEvent, 16),
	}
}

func (s *SSEClient) Events() <-chan SSEEvent { return s.eventCh }

func (s *SSEClient) Start() { go s.connectLoop() }

func (s *SSEClient) Stop() { s.cancel() }

func (s *SSEClient) connectLoop() {
	delay := sseReconnectDelay
	for {
		select {
		case <-s.ctx.Done():
			close(s.eventCh)
			return
		default:
		}
		start := time.Now()
		err := s.connect()
		if err != nil {
			log.Printf("[SSE] Connection error: %v", err)
		}
		// Reset delay if connection lasted more than 30 seconds (was a healthy connection)
		if time.Since(start) > 30*time.Second {
			delay = sseReconnectDelay
		}
		select {
		case <-s.ctx.Done():
			close(s.eventCh)
			return
		default:
		}
		log.Printf("[SSE] Reconnecting in %v...", delay)
		select {
		case <-time.After(delay):
		case <-s.ctx.Done():
			close(s.eventCh)
			return
		}
		delay = delay * 2
		if delay > sseMaxReconnectDelay {
			delay = sseMaxReconnectDelay
		}
	}
}

func (s *SSEClient) connect() error {
	url := s.client.baseURL + "/api/agent/sse"
	req, err := http.NewRequestWithContext(s.ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.client.token)
	req.Header.Set("Accept", "text/event-stream")

	httpClient := &http.Client{Timeout: 0}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	log.Println("[SSE] Connected to management platform")
	scanner := bufio.NewScanner(resp.Body)
	var currentEvent SSEEvent

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if currentEvent.Event != "" {
				select {
				case s.eventCh <- currentEvent:
				case <-s.ctx.Done():
					return nil
				}
			}
			currentEvent = SSEEvent{}
			continue
		}
		if strings.HasPrefix(line, "event: ") {
			currentEvent.Event = strings.TrimPrefix(line, "event: ")
		} else if strings.HasPrefix(line, "data: ") {
			currentEvent.Data = strings.TrimPrefix(line, "data: ")
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read stream: %w", err)
	}
	return fmt.Errorf("stream closed by server")
}
