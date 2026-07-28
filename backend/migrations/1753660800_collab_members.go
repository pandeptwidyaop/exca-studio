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

		for _, name := range []string{"editors", "viewers"} {
			collection.Schema.AddField(&schema.SchemaField{
				Name: name,
				Type: schema.FieldTypeRelation,
				Options: &schema.RelationOptions{
					CollectionId:  "_pb_users_auth_",
					CascadeDelete: false,
					MaxSelect:     nil, // multiple
				},
			})
		}

		memberVisible := "@request.auth.id = user.id || editors.id ?= @request.auth.id || viewers.id ?= @request.auth.id"
		// Owner: unrestricted. Editor: may only touch `scene`.
		editorSceneOnly := "@request.auth.id = user.id || (editors.id ?= @request.auth.id && @request.data.name:isset = false && @request.data.user:isset = false && @request.data.editors:isset = false && @request.data.viewers:isset = false)"

		listRule := memberVisible
		viewRule := memberVisible
		updateRule := editorSceneOnly
		collection.ListRule = &listRule
		collection.ViewRule = &viewRule
		collection.UpdateRule = &updateRule

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		collection, err := dao.FindCollectionByNameOrId("projects")
		if err != nil {
			return err
		}

		for _, name := range []string{"editors", "viewers"} {
			if f := collection.Schema.GetFieldByName(name); f != nil {
				collection.Schema.RemoveField(f.Id)
			}
		}

		ownerOnly := "@request.auth.id = user.id"
		listRule := ownerOnly
		viewRule := ownerOnly
		updateRule := ownerOnly
		collection.ListRule = &listRule
		collection.ViewRule = &viewRule
		collection.UpdateRule = &updateRule

		return dao.SaveCollection(collection)
	})
}
