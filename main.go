package main

import (
	"embed"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"

	"github.com/bavix/boxpacker3-ui/internal/app"
)

//go:embed public
var publicFiles embed.FS

func main() {
	htmlContent, err := fs.Sub(publicFiles, "public")
	if err != nil {
		log.Fatal(err)
	}

	http.Handle("/", http.FileServer(http.FS(htmlContent)))

	http.HandleFunc("/bp3", app.Bp3Handle)
	http.HandleFunc("/bp3boxes", app.Bp3DefaultBoxesHandle)

	host, _ := os.LookupEnv("HOST")
	port, ok := os.LookupEnv("PORT")
	if !ok {
		port = "8080"
	}

	addr := net.JoinHostPort(host, port)
	log.Printf("Listening on %s...\n", addr)

	err = http.ListenAndServe(addr, nil)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
