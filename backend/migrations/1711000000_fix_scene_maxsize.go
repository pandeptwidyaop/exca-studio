package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		// Update scene field to have proper MaxSize (20MB)
		sceneField := collection.Schema.GetFieldByName("scene")
		if sceneField != nil {
			sceneField.Options = &schema.JsonOptions{
				MaxSize: 20000000, // 20MB
			}
		}

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		sceneField := collection.Schema.GetFieldByName("scene")
		if sceneField != nil {
			sceneField.Options = &schema.JsonOptions{}
		}

		return dao.SaveCollection(collection)
	})
}
