package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		// Update projects collection rules
		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		// Set API rules - users can only access their own projects
		collection.ListRule = toStringPtr("@request.auth.id = user.id")
		collection.ViewRule = toStringPtr("@request.auth.id = user.id")
		collection.CreateRule = toStringPtr("@request.auth.id != ''")
		collection.UpdateRule = toStringPtr("@request.auth.id = user.id")
		collection.DeleteRule = toStringPtr("@request.auth.id = user.id")

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		// Revert - set rules back to nil (admin only)
		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		collection.ListRule = nil
		collection.ViewRule = nil
		collection.CreateRule = nil
		collection.UpdateRule = nil
		collection.DeleteRule = nil

		return dao.SaveCollection(collection)
	})
}

func toStringPtr(s string) *string {
	return &s
}
