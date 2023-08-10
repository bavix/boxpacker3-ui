package main

import (
	"embed"
	"github.com/bavix/boxpacker3-ui/internal/app"
	"io/fs"
	"log"
	"net/http"
	"os"
)

//go:embed public
var publicFiles embed.FS

func main() {
	publicFS := fs.FS(publicFiles)
	publicContent, err := fs.Sub(publicFS, "public")
	if err != nil {
		log.Fatal(err)
	}

	http.Handle("/", http.FileServer(http.FS(publicContent)))
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	http.HandleFunc("/bp3", app.Bp3Handle)
	http.HandleFunc("/bp3boxes", app.Bp3DefaultBoxesHandle)

	log.Printf("Listening on :%s...", port)
	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatal(err)
	}
}
