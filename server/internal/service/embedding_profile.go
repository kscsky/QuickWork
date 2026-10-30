package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kscsky/quickwork/server/internal/knowledge"
	"github.com/kscsky/quickwork/server/internal/util"
	db "github.com/kscsky/quickwork/server/pkg/db/generated"
)

// Embedding profiles pin a provider, model, dimension and an encrypted API
// key. An entry is embedded exactly once, under one profile: its dimension is
// part of the data's identity, not a query-time option.

var (
	ErrEmbeddingProfileNotFound = errors.New("embedding profile not found")
	ErrEmbeddingProfileExists   = errors.New("this provider, model and dimension already exists")
	ErrEmbeddingProfileActive   = errors.New("activate another profile before deleting the active one")
	ErrEmbeddingProfileInUse    = errors.New("this profile still has indexed entries")
	ErrEmbeddingKeyUnavailable  = knowledge.ErrSecretKeyMissing
)

type EmbeddingProfileRequest struct {
	Provider string
	BaseURL  string
	Model    string
	Dims     int
	APIKey   string
	Activate bool
}

type EmbeddingProfileService struct {
	Queries *db.Queries
	Cipher  *knowledge.SecretCipher
}

func NewEmbeddingProfileService(q *db.Queries, cipher *knowledge.SecretCipher) *EmbeddingProfileService {
	return &EmbeddingProfileService{Queries: q, Cipher: cipher}
}

func (s *EmbeddingProfileService) List(ctx context.Context, wsID pgtype.UUID) ([]db.WorkspaceEmbeddingProfile, error) {
	return s.Queries.ListWorkspaceEmbeddingProfiles(ctx, wsID)
}

func (s *EmbeddingProfileService) Active(ctx context.Context, wsID pgtype.UUID) (db.WorkspaceEmbeddingProfile, error) {
	row, err := s.Queries.GetActiveWorkspaceEmbeddingProfile(ctx, wsID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.WorkspaceEmbeddingProfile{}, ErrEmbeddingProfileNotFound
		}
		return db.WorkspaceEmbeddingProfile{}, err
	}
	return row, nil
}

func (s *EmbeddingProfileService) Get(ctx context.Context, wsID, id pgtype.UUID) (db.WorkspaceEmbeddingProfile, error) {
	row, err := s.Queries.GetWorkspaceEmbeddingProfile(ctx, db.GetWorkspaceEmbeddingProfileParams{
		ID:          id,
		WorkspaceID: wsID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.WorkspaceEmbeddingProfile{}, ErrEmbeddingProfileNotFound
		}
		return db.WorkspaceEmbeddingProfile{}, err
	}
	return row, nil
}

// Create probes the provider before it stores anything: a saved profile is a
// promise that the key, model and dimension actually work together.
func (s *EmbeddingProfileService) Create(
	ctx context.Context,
	wsID, actorID pgtype.UUID,
	req EmbeddingProfileRequest,
) (db.WorkspaceEmbeddingProfile, error) {
	if s.Cipher == nil {
		return db.WorkspaceEmbeddingProfile{}, ErrEmbeddingKeyUnavailable
	}
	provider := strings.TrimSpace(req.Provider)
	model := strings.TrimSpace(req.Model)
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return db.WorkspaceEmbeddingProfile{}, errors.New("API key is required")
	}
	baseURL, err := knowledge.ResolveProvider(provider, req.BaseURL)
	if err != nil {
		return db.WorkspaceEmbeddingProfile{}, err
	}
	if err := knowledge.ValidateModelDims(provider, model, req.Dims); err != nil {
		return db.WorkspaceEmbeddingProfile{}, err
	}
	probeCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	if err := knowledge.ProbeEmbedding(probeCtx, baseURL, apiKey, model, req.Dims); err != nil {
		return db.WorkspaceEmbeddingProfile{}, err
	}
	cipherText, err := s.Cipher.Encrypt(apiKey)
	if err != nil {
		return db.WorkspaceEmbeddingProfile{}, err
	}
	existing, err := s.Queries.CountWorkspaceEmbeddingProfiles(ctx, wsID)
	if err != nil {
		return db.WorkspaceEmbeddingProfile{}, err
	}
	activate := req.Activate || existing == 0
	row, err := s.Queries.CreateWorkspaceEmbeddingProfile(ctx, db.CreateWorkspaceEmbeddingProfileParams{
		WorkspaceID:  wsID,
		Provider:     provider,
		BaseUrl:      baseURL,
		Model:        model,
		Dims:         int32(req.Dims),
		ApiKeyCipher: cipherText,
		KeyHint:      knowledge.KeyHint(apiKey),
		IsActive:     false,
		CreatedBy:    actorID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return db.WorkspaceEmbeddingProfile{}, ErrEmbeddingProfileExists
		}
		return db.WorkspaceEmbeddingProfile{}, err
	}
	if activate {
		if err := s.Activate(ctx, wsID, row.ID); err != nil {
			return db.WorkspaceEmbeddingProfile{}, err
		}
		return s.Get(ctx, wsID, row.ID)
	}
	return row, nil
}

func (s *EmbeddingProfileService) Activate(ctx context.Context, wsID, id pgtype.UUID) error {
	if _, err := s.Get(ctx, wsID, id); err != nil {
		return err
	}
	return s.Queries.ActivateWorkspaceEmbeddingProfile(ctx, db.ActivateWorkspaceEmbeddingProfileParams{
		ID:          id,
		WorkspaceID: wsID,
	})
}

func (s *EmbeddingProfileService) Delete(ctx context.Context, wsID, id pgtype.UUID) error {
	row, err := s.Get(ctx, wsID, id)
	if err != nil {
		return err
	}
	if row.IsActive {
		return ErrEmbeddingProfileActive
	}
	used, err := s.Queries.CountEmbeddingsForProfile(ctx, row.ID)
	if err != nil {
		return err
	}
	if used > 0 {
		return ErrEmbeddingProfileInUse
	}
	removed, err := s.Queries.DeleteWorkspaceEmbeddingProfile(ctx, db.DeleteWorkspaceEmbeddingProfileParams{
		ID:          id,
		WorkspaceID: wsID,
	})
	if err != nil {
		return err
	}
	if removed == 0 {
		return ErrEmbeddingProfileNotFound
	}
	return nil
}

// ResolvedEmbedding is a profile ready to embed queries or entries.
type ResolvedEmbedding struct {
	ProfileID pgtype.UUID
	Provider  string
	Model     string
	Dims      int
	Embedder  knowledge.Embedder
}

// Resolve loads the requested profile, or the workspace's active profile when
// id is empty. A missing profile is a product state, not an error.
func (s *EmbeddingProfileService) Resolve(ctx context.Context, wsID, id pgtype.UUID) (*ResolvedEmbedding, error) {
	var row db.WorkspaceEmbeddingProfile
	var err error
	if id.Valid {
		row, err = s.Get(ctx, wsID, id)
	} else {
		row, err = s.Active(ctx, wsID)
		if errors.Is(err, ErrEmbeddingProfileNotFound) {
			return nil, nil
		}
	}
	if err != nil {
		return nil, err
	}
	if s.Cipher == nil {
		return nil, ErrEmbeddingKeyUnavailable
	}
	apiKey, err := s.Cipher.Decrypt(row.ApiKeyCipher)
	if err != nil {
		return nil, err
	}
	return &ResolvedEmbedding{
		ProfileID: row.ID,
		Provider:  row.Provider,
		Model:     row.Model,
		Dims:      int(row.Dims),
		Embedder:  knowledge.NewOpenAIEmbedder(row.BaseUrl, apiKey, row.Model, int(row.Dims)),
	}, nil
}

// KnowledgeCorpus is one dimension partition shown on the model card.
type KnowledgeCorpus struct {
	ProfileID string `json:"profile_id"`
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Dims      int    `json:"dims"`
	Entries   int64  `json:"entries"`
	Active    bool   `json:"active"`
}

func (s *EmbeddingProfileService) Corpora(ctx context.Context, wsID pgtype.UUID) ([]KnowledgeCorpus, int64, error) {
	rows, err := s.Queries.CountKnowledgeEmbeddingsByProfile(ctx, wsID)
	if err != nil {
		return nil, 0, err
	}
	out := make([]KnowledgeCorpus, 0, len(rows))
	for _, row := range rows {
		out = append(out, KnowledgeCorpus{
			ProfileID: util.UUIDToString(row.ProfileID),
			Provider:  row.Provider,
			Model:     row.Model,
			Dims:      int(row.Dims),
			Entries:   row.Entries,
			Active:    row.IsActive,
		})
	}
	unindexed, err := s.Queries.CountUnindexedKnowledgeEntries(ctx, wsID)
	if err != nil {
		return nil, 0, err
	}
	return out, unindexed, nil
}
