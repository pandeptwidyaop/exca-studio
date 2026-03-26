package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/models/schema"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		// Create projects collection
		projects := &models.Collection{
			Name:       "projects",
			Type:       models.CollectionTypeBase,
			ListRule:   nil,
			ViewRule:   nil,
			CreateRule: nil,
			UpdateRule: nil,
			DeleteRule: nil,
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "user",
					Type:     schema.FieldTypeRelation,
					Required: true,
					Options: &schema.RelationOptions{
						CollectionId:  "_pb_users_auth_",
						CascadeDelete: false,
						MinSelect:     nil,
						MaxSelect:     makeIntPtr(1),
					},
				},
				&schema.SchemaField{
					Name:     "name",
					Type:     schema.FieldTypeText,
					Required: true,
					Options: &schema.TextOptions{
						Min: nil,
						Max: nil,
					},
				},
				&schema.SchemaField{
					Name:     "scene",
					Type:     schema.FieldTypeJson,
					Required: false,
					Options: &schema.JsonOptions{
						MaxSize: 20000000, // 20MB — Excalidraw scenes can be large
					},
				},
			),
		}

		if err := dao.SaveCollection(projects); err != nil {
			return err
		}

		return nil
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		// Delete projects collection
		projects, err := dao.FindCollectionByNameOrId("projects")
		if err == nil {
			if err := dao.DeleteCollection(projects); err != nil {
				return err
			}
		}

		return nil
	})
}

func makeIntPtr(i int) *int {
	return &i
}
