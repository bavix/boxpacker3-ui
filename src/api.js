import axios from "axios";

export default async function (url, data) {
    return await axios.post(url, data).then(
        resp => resp.data
    )
}
